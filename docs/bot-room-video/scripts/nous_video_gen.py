#!/usr/bin/env python3
"""Submit a video-gen job through the Nous Portal Tool Gateway (fal-queue).

Auth: OAuth access token cached by `hermes setup --portal` at ~/.hermes/auth.json,
or TOOL_GATEWAY_USER_TOKEN env override. The sk-nous-* inference key does NOT work here.

Usage:
  python3 nous_video_gen.py --prompt "..." --image path.png [--model fal-ai/pixverse/v6/image-to-video]
                          [--duration 5] [--resolution 720p] [--out out.mp4]
"""
import argparse, base64, json, os, sys, time, urllib.request, urllib.error

ORIGIN = "https://fal-queue-gateway.nousresearch.com"


def load_token() -> str:
    tok = os.getenv("TOOL_GATEWAY_USER_TOKEN", "").strip()
    if tok:
        return tok
    try:  # live OAuth token w/ auto-refresh (expired static ones 401 on the gateway)
        from hermes_cli.auth import resolve_nous_access_token
        tok = resolve_nous_access_token().strip()
        if tok:
            return tok
    except Exception as exc:
        print(f"[auth] resolver unavailable ({exc}); falling back to auth.json", file=sys.stderr)
    path = os.path.expanduser("~/.hermes/auth.json")
    with open(path) as f:
        data = json.load(f)
    # auth.json shape: {"providers": {"nous": {"access_token": ...}}} or flat {"nous": {...}}
    for key in ("providers",):
        prov = data.get(key, {}).get("nous")
        if isinstance(prov, dict) and prov.get("access_token"):
            return prov["access_token"]
    prov = data.get("nous")
    if isinstance(prov, dict) and prov.get("access_token"):
        return prov["access_token"]
    raise SystemExit("No nous access_token in ~/.hermes/auth.json — run `hermes setup --portal` first")


def http(method: str, url: str, token: str, body=None, auth_scheme="Key"):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"{auth_scheme} {token}")
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--image", help="Local image for i2v (sent as data URI)")
    ap.add_argument("--model", default="fal-ai/pixverse/v6/text-to-video")
    ap.add_argument("--duration", default="5")
    ap.add_argument("--resolution", default="720p")
    ap.add_argument("--aspect", default="16:9")
    ap.add_argument("--out", default="out.mp4")
    ap.add_argument("--negative", default="")
    ap.add_argument("--audio", action="store_true", help="generate_audio=true (native sound)")
    args = ap.parse_args()

    token = load_token()
    payload = {
        "prompt": args.prompt,
        "aspect_ratio": args.aspect,
        "resolution": args.resolution,
        "duration": args.duration,
        "seed": 42,
    }
    if args.audio:
        payload["generate_audio"] = True
    if args.negative:
        payload["negative_prompt"] = args.negative
    if args.image:
        ext = os.path.splitext(args.image)[1].lstrip(".").lower() or "png"
        mime = "jpeg" if ext in ("jpg", "jpeg") else ext
        with open(args.image, "rb") as f:
            data_uri = f"data:image/{mime};base64,{base64.b64encode(f.read()).decode()}"
        if "kling" in args.model:
            payload["start_image_url"] = data_uri
        else:
            payload["image_url"] = data_uri
        if "/text-to-video" in args.model:
            args.model = args.model.replace("/text-to-video", "/image-to-video")
    if "kling" in args.model:  # v3 i2v derives aspect from image; no resolution/seed keys
        for k in ("aspect_ratio", "resolution", "seed"):
            payload.pop(k, None)

    url = f"{ORIGIN}/{args.model}"
    for scheme in ("Key", "Bearer"):
        code, resp = http("POST", url, token, payload, auth_scheme=scheme)
        if code != 401:
            break
        print(f"[auth] {scheme} -> 401, trying next scheme", file=sys.stderr)
    if code not in (200, 201, 202):
        print(f"SUBMIT FAILED {code}: {json.dumps(resp)[:2000]}", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(resp, indent=2)[:800])

    status_url = resp.get("status_url") or f"{url}/requests/{resp['request_id']}/status"
    response_url = resp.get("response_url") or f"{url}/requests/{resp['request_id']}"
    scheme_used = scheme

    while True:
        code, st = http("GET", status_url, token, auth_scheme=scheme_used)
        status = st.get("status")
        print(f"[poll] {code} {status} {st.get('queue_position','')}", flush=True)
        if status in ("COMPLETED", "OK") or code == 200 and st.get("video"):
            break
        if status in ("FAILED", "CANCELLED") or code >= 400:
            print(f"JOB FAILED: {json.dumps(st)[:2000]}", file=sys.stderr)
            sys.exit(1)
        time.sleep(5)

    code, result = http("GET", response_url, token, auth_scheme=scheme_used)
    video_url = (result.get("video") or {}).get("url") or result.get("video_url") or (result.get("output") or {}).get("video", {}).get("url")
    if not video_url:
        print(f"NO VIDEO URL: {json.dumps(result)[:2000]}", file=sys.stderr)
        sys.exit(1)
    urllib.request.urlretrieve(video_url, args.out)
    print(f"SAVED {args.out} <- {video_url}")


if __name__ == "__main__":
    main()

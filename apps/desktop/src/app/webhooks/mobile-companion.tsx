import { useStore } from '@nanostores/react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldHint } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { createMobilePairingCode } from '@/hermes'
import { useI18n } from '@/i18n'
import { Smartphone } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $activeConnectionId, $connectionsRegistry } from '@/store/connections'
import { notifyError } from '@/store/notifications'

// One affordance for "value + CopyButton": flat, token-backed (no border, no
// raw literals). DESIGN.md Principle 1 (flat, not boxed) + 4 (tokens, not
// literals). Shared by this page's detail URL row, the create-result rows, and
// the companion pairing link.
export function CopyValueRow({ copyLabel, mono = true, value }: { copyLabel: string; mono?: boolean; value: string }) {
  return (
    <div className="flex items-center gap-1 rounded bg-foreground/5 px-2.5 py-1.5 text-[0.7rem]">
      <span className={cn('min-w-0 flex-1 truncate text-foreground/80', mono && 'font-mono')}>{value}</span>
      <CopyButton appearance="icon" buttonSize="icon-sm" label={copyLabel} text={value} />
    </div>
  )
}

// Roadmap #45: pair a phone to the served backend. The desktop mints a
// short-lived code (`POST /api/mobile/pairing`); the phone redeems it at
// `POST /api/mobile/pair` for the session token and then steers the backend's
// minimal `/mobile` surface — status, approvals, quick replies. The card is a
// quiet offer: it never opens the dialog by itself.
export function MobileCompanion() {
  const { t } = useI18n()
  const m = t.webhooks.mobile

  const [open, setOpen] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [code, setCode] = useState<null | string>(null)
  const [expiresIn, setExpiresIn] = useState(0)
  const [creating, setCreating] = useState(false)
  const [urlEdited, setUrlEdited] = useState(false)

  const registry = useStore($connectionsRegistry)
  const activeConnectionId = useStore($activeConnectionId)

  // Only remote connections carry a phone-reachable URL; a local backend binds
  // loopback, so the field stays editable for a LAN/tunnel address.
  const defaultUrl = useMemo(() => {
    const conn =
      registry?.connections.find(c => c.id === activeConnectionId) ??
      registry?.connections.find(c => c.id === registry.primary)

    return conn?.url ?? ''
  }, [registry, activeConnectionId])

  const effectiveBaseUrl = (urlEdited ? baseUrl : defaultUrl).trim().replace(/\/+$/, '')
  const pageUrl = effectiveBaseUrl ? `${effectiveBaseUrl}/mobile` : ''

  const reset = () => {
    setCode(null)
    setExpiresIn(0)
    setCreating(false)
  }

  const createCode = async () => {
    setCreating(true)

    try {
      const pairing = await createMobilePairingCode()
      setCode(pairing.code)
      setExpiresIn(pairing.expires_in)
    } catch (err) {
      notifyError(err, m.createFailed(''))
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-3 rounded-lg bg-foreground/[0.03] px-3 py-2.5">
        <Smartphone className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground">{m.title}</p>
          <p className="truncate text-[0.7rem] text-muted-foreground">{m.hint}</p>
        </div>
        <Button
          onClick={() => {
            reset()
            setOpen(true)
          }}
          size="sm"
          variant="secondary"
        >
          {m.pairButton}
        </Button>
      </div>

      <Dialog onOpenChange={next => !next && setOpen(false)} open={open}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{m.dialogTitle}</DialogTitle>
            <DialogDescription>{m.dialogDesc}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Field htmlFor="mobile-companion-url" label={m.backendUrl}>
                <Input
                  id="mobile-companion-url"
                  onChange={e => {
                    setBaseUrl(e.target.value)
                    setUrlEdited(true)
                  }}
                  placeholder="https://hermes.example.ts.net"
                  value={urlEdited ? baseUrl : defaultUrl}
                />
              </Field>
              <FieldHint>{m.backendUrlHint}</FieldHint>
            </div>

            {code ? (
              <div className="grid gap-1.5">
                <Field label={m.codeLabel}>
                  <p className="rounded bg-foreground/5 px-3 py-2 text-center font-mono text-2xl tracking-[0.35em] text-foreground">
                    {code}
                  </p>
                </Field>
                {pageUrl && <CopyValueRow copyLabel={m.copy} value={pageUrl} />}
                <FieldHint>{m.openHint(pageUrl || '/mobile')}</FieldHint>
                <FieldHint>{m.expires(Math.ceil(expiresIn / 60))}</FieldHint>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button onClick={() => setOpen(false)} variant="secondary">
              {m.done}
            </Button>
            <Button disabled={creating || code !== null} onClick={() => void createCode()}>
              {creating ? m.creating : m.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

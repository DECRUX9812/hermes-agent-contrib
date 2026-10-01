"""Demo MCP Apps server: an interactive launch board rendered inside the chat."""
from mcp.server import MCPServer
from mcp.server.apps import Apps

apps = Apps()
TASKS = [
    {"id": "copy", "title": "Announcement copy", "owner": "Scout", "done": True},
    {"id": "changelog", "title": "Changelog", "owner": "Forge", "done": False},
    {"id": "docs", "title": "Docs refresh", "owner": "Scout", "done": False},
    {"id": "deploy", "title": "Deploy to prod", "owner": "Pilot", "done": False},
]

@apps.tool(resource_uri="ui://launch/board.html", description="Show the launch board")
def show_board() -> str:
    done = sum(t["done"] for t in TASKS)
    return f"Launch board: {done}/{len(TASKS)} done."

@apps.tool(resource_uri="ui://launch/board.html", visibility=["app"], description="List launch tasks")
def list_tasks() -> dict:
    return {"tasks": TASKS}

@apps.tool(resource_uri="ui://launch/board.html", visibility=["app"], description="Toggle a launch task")
def toggle_task(id: str) -> dict:
    for t in TASKS:
        if t["id"] == id:
            t["done"] = not t["done"]
    return {"tasks": TASKS}

BOARD = r"""<!doctype html><html><head><meta name=viewport content="width=device-width">
<style>
:root{--bg:#fff;--fg:#141414;--mut:#6b6b6b;--card:#f6f5f2;--acc:#7c5cff;--ok:#1f9d63}
.dark{--bg:#161616;--fg:#f2f2f2;--mut:#9a9a9a;--card:#222;--acc:#9b85ff;--ok:#3ccf8e}
*{box-sizing:border-box}body{margin:0;font:14px/1.4 Inter,system-ui,sans-serif;background:var(--bg);color:var(--fg);padding:14px}
h1{font-size:15px;margin:0 0 2px}.sub{color:var(--mut);font-size:12px;margin-bottom:10px}
.bar{height:6px;border-radius:9px;background:var(--card);overflow:hidden;margin-bottom:12px}
.fill{height:100%;background:linear-gradient(90deg,var(--acc),var(--ok));width:0;transition:width .6s cubic-bezier(.2,.8,.2,1)}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.card{background:var(--card);border-radius:12px;padding:10px 12px;cursor:pointer;display:flex;gap:10px;align-items:center;
 transition:transform .15s,background .3s;border:1px solid transparent}.card:hover{transform:translateY(-1px);border-color:var(--acc)}
.chk{width:20px;height:20px;border-radius:50%;border:2px solid var(--mut);display:grid;place-items:center;transition:all .25s;flex:none}
.done .chk{background:var(--ok);border-color:var(--ok)}.done .chk:after{content:"✓";color:#fff;font-size:12px}
.done .t{text-decoration:line-through;color:var(--mut)}.o{color:var(--mut);font-size:12px}
</style></head><body><h1>🚀 Launch board</h1><div class=sub id=sub>Loading…</div><div class=bar><div class=fill id=fill></div></div><div class=grid id=grid></div>
<script>
let id=0;const pend={};const rpc=(method,params)=>new Promise(r=>{const i=++id;pend[i]=r;parent.postMessage({jsonrpc:'2.0',id:i,method,params},'*')});
const tasksOf=r=>{const res=r.result||{};const sc=res.structuredContent;if(sc&&sc.tasks)return sc.tasks;try{return JSON.parse(res.content[0].text).tasks}catch(e){return []}};
function render(tasks){const done=tasks.filter(t=>t.done).length;document.getElementById('sub').textContent=done+' of '+tasks.length+' done · tap a card to toggle';
document.getElementById('fill').style.width=(100*done/tasks.length)+'%';const g=document.getElementById('grid');g.innerHTML='';
for(const t of tasks){const c=document.createElement('div');c.className='card'+(t.done?' done':'');c.innerHTML='<div class=chk></div><div><div class=t></div><div class=o></div></div>';
c.querySelector('.t').textContent=t.title;c.querySelector('.o').textContent=t.owner;c.onclick=async()=>{const r=await rpc('tools/call',{name:'toggle_task',arguments:{id:t.id}});render(tasksOf(r))};g.appendChild(c)}
parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:document.body.scrollHeight+4}},'*')}
addEventListener('message',e=>{const m=e.data;if(m&&m.id&&pend[m.id]){pend[m.id](m);delete pend[m.id]}});
(async()=>{const init=await rpc('ui/initialize',{});if(init.result&&init.result.hostContext&&init.result.hostContext.theme==='dark')document.documentElement.classList.add('dark');
parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*');const r=await rpc('tools/call',{name:'list_tasks',arguments:{}});render(tasksOf(r))})();
</script></body></html>"""
apps.add_html_resource("ui://launch/board.html", BOARD)
MCPServer("launch", extensions=[apps]).run("stdio")

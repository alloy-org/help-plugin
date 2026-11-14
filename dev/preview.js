import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import vm from "node:vm";

const plugin = vm.runInNewContext(await readFile("build/compiled.js", "utf8"));
const bridge = `<script>window.callAmplenotePlugin=async(action,payload)=>{const r=await fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!r.ok)return {ok:false,error:'Help request failed ('+r.status+').'};return {ok:true,response:await r.json()};};</script>`;
const html = plugin.renderEmbed.run().replace("<head>", "<head>" + bridge);
const upstream = process.env.HELP_API_URL || "https://amplenote.noteapps.info/help";
createServer(async (request, response) => {
  if (request.url === "/" && request.method === "GET") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
  } else if (request.url === "/chat" && request.method === "POST") {
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 32768) { response.writeHead(413); response.end(); return; }
        chunks.push(chunk);
      }
      const result = await fetch(upstream + "/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: Buffer.concat(chunks), signal: AbortSignal.timeout(60000) });
      response.writeHead(result.status, { "Content-Type": "application/json" });
      response.end(await result.text());
    } catch { response.writeHead(502); response.end('{"error":"Help endpoint unreachable"}'); }
  } else { response.writeHead(404); response.end(); }
}).listen(8093, "127.0.0.1", () => console.log("Help preview: http://127.0.0.1:8093"));

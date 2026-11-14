import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const endpoint = process.env.HELP_API_URL || "https://amplenote.noteapps.info/help";
const parsed = new URL(endpoint);
if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname))) {
  throw new Error("HELP_API_URL must use HTTPS, or HTTP on localhost for development.");
}

const client = await build({
  entryPoints: ["lib/chat-client.js"], bundle: true, format: "iife", minify: true,
  write: false, target: ["chrome91", "firefox90", "safari15"],
});
const payload = {
  clientBase64: Buffer.from(client.outputFiles[0].text).toString("base64"),
  styles: await readFile("lib/chat.css", "utf8"),
};
const host = await build({
  entryPoints: ["lib/plugin.js"], bundle: true, format: "iife", globalName: "helpPlugin",
  minify: true, write: false, platform: "browser", target: ["chrome91", "firefox90", "safari15"],
  define: { __HELP_API_URL__: JSON.stringify(endpoint.replace(/\/$/, "")) },
  plugins: [{
    name: "chat-payload",
    setup(builder) {
      builder.onResolve({ filter: /^chat-payload$/ }, () => ({ path: "chat-payload", namespace: "chat-payload" }));
      builder.onLoad({ filter: /.*/, namespace: "chat-payload" }, () => ({
        contents: `export default ${JSON.stringify(payload)};`, loader: "js",
      }));
    },
  }],
});
await mkdir("build", { recursive: true });
await writeFile("build/compiled.js", `(() => {\n${host.outputFiles[0].text}\nreturn helpPlugin.default;\n})()\n`);
console.log("Built build/compiled.js for " + endpoint);

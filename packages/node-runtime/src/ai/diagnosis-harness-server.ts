import { createServer, type IncomingMessage, type Server } from "node:http";
import type { DiagnosisFlow, ObservationMode } from "@hongtai/ai";
import { TaskError } from "@hongtai/core";
import type { ImagePreprocessor } from "./sharp-image-preprocessor";

const PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本地图片观察测试</title><style>body{font-family:system-ui;max-width:760px;margin:40px auto;padding:0 16px}label,button,textarea{display:block;margin:12px 0}textarea{width:100%;min-height:72px}.message{padding:10px;background:#f4f4f4;margin:8px 0;white-space:pre-wrap}.error{color:#b00020}</style></head><body><h1>本地图片观察测试</h1><label>类型 <select id="mode"><option value="tongue">舌象</option><option value="face">面部</option></select></label><input id="image" type="file" accept="image/jpeg,image/png,image/webp"><button id="upload">上传并分析</button><p id="status"></p><section id="report"></section><section id="messages"></section><textarea id="question" placeholder="输入后续问题"></textarea><button id="send">发送问题</button><script>
let sessionId='';
const status=document.querySelector('#status');
const report=document.querySelector('#report');
const messages=document.querySelector('#messages');
const textElement=(tag,value,className)=>{const element=document.createElement(tag);element.textContent=String(value??'');if(className)element.className=className;return element};
const errorMessage=(error)=>error instanceof Error?error.message:'本地测试入口发生未知错误';
document.querySelector('#upload').addEventListener('click',async()=>{try{const file=document.querySelector('#image').files[0];if(!file)throw new Error('请选择图片');status.textContent='分析中…';const imageDataUrl=await new Promise((ok,bad)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=bad;r.readAsDataURL(file)});const res=await fetch('/api/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:document.querySelector('#mode').value,imageDataUrl})});const data=await res.json();if(!res.ok)throw new Error(data.error);sessionId=data.sessionId;const summary=data.report.summary;report.textContent='';report.append(textElement('h2',summary.headline),textElement('div',summary.narrative,'message'));const keyPoints=document.createElement('ul');for(const point of Array.isArray(summary.keyPoints)?summary.keyPoints:[])keyPoints.append(textElement('li',point));report.append(keyPoints);status.textContent='完成：'+sessionId}catch(e){status.className='error';status.textContent=errorMessage(e)}});
document.querySelector('#send').addEventListener('click',async()=>{try{if(!sessionId)throw new Error('请先上传图片');const question=document.querySelector('#question').value.trim();const res=await fetch('/api/sessions/'+sessionId+'/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question})});const data=await res.json();if(!res.ok)throw new Error(data.error);messages.append(textElement('div','你：'+question,'message'),textElement('div','AI：'+data.message.content,'message'));document.querySelector('#question').value=''}catch(e){status.className='error';status.textContent=errorMessage(e)}});
</script></body></html>`;

async function bodyJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 20 * 1024 * 1024) throw new TaskError({ code: "IMAGE_TOO_LARGE", message: "请求内容不能超过20MB", action: "edit_input" });
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch (error) {
    throw new TaskError({ code: "INPUT_URL_INVALID", message: "请求JSON无效", action: "edit_input", cause: error });
  }
}

function imageFromDataUrl(value: unknown): { mimeType: string; data: Uint8Array } {
  if (typeof value !== "string") throw new TaskError({ code: "IMAGE_INVALID", message: "缺少图片", action: "edit_input" });
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match?.[1] || !match[2]) throw new TaskError({ code: "IMAGE_INVALID", message: "图片数据格式无效", action: "edit_input" });
  return { mimeType: match[1], data: Buffer.from(match[2], "base64") };
}

function sendJson(response: import("node:http").ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(value));
}

export function createDiagnosisHarnessServer(dependencies: {
  readonly flow: DiagnosisFlow;
  readonly preprocessor: ImagePreprocessor;
  readonly onSessionCreated?: (sessionId: string) => void | Promise<void>;
}): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'", "cache-control": "no-store" });
        response.end(PAGE);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/sessions") {
        const body = await bodyJson(request);
        if (body.mode !== "tongue" && body.mode !== "face") throw new TaskError({ code: "INPUT_URL_INVALID", message: "必须选择舌象或面部", action: "edit_input" });
        const source = imageFromDataUrl(body.imageDataUrl);
        const image = await dependencies.preprocessor.normalize(source.data, source.mimeType);
        const result = await dependencies.flow.analyze({ mode: body.mode as ObservationMode, image });
        await dependencies.onSessionCreated?.(result.session.id);
        sendJson(response, 201, { sessionId: result.session.id, report: result.report });
        return;
      }
      const messageMatch = /^\/api\/sessions\/([a-zA-Z0-9-]+)\/messages$/.exec(url.pathname);
      if (request.method === "POST" && messageMatch?.[1]) {
        const body = await bodyJson(request);
        const message = await dependencies.flow.chat(messageMatch[1], typeof body.question === "string" ? body.question : "");
        sendJson(response, 200, { message });
        return;
      }
      sendJson(response, 404, { error: "未找到接口" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "本地测试入口发生未知错误";
      const status = error instanceof TaskError && (error.code === "IMAGE_TOO_LARGE") ? 413 : 400;
      sendJson(response, status, { error: message, code: error instanceof TaskError ? error.code : "INTERNAL_UNKNOWN_ERROR" });
    }
  });
}

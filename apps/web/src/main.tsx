import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/global.css";

function FoundationPreview() {
  return (
    <main className="foundation-preview">
      <p className="eyebrow">HONGTAI / VISUAL SYSTEM</p>
      <h1>宏泰 AI 智能体</h1>
      <p>静态视觉应用基础已就绪。</p>
    </main>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("缺少前端根节点");
}

createRoot(root).render(
  <StrictMode>
    <FoundationPreview />
  </StrictMode>,
);

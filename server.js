const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cors = require("cors");

const app = express();
app.use(express.json());

// ✅ 开发期先放开；稳定后可以改成只允许你的前端域名
app.use(cors({ origin: "*" }));

// Render 会给 PORT（日志里你看到的 10000 就是它给的）
const PORT = process.env.PORT || 3000;

// ====== 目录结构（相对 server.js 所在目录）======
// 你的项目里应该是：
// - server.js
// - package.json
// - codes.json
// - paid/img_paid/1.jpg  2.jpg ...
const PRIVATE_IMG_DIR = path.join(__dirname, "paid", "img_paid");
const CODES_FILE = path.join(__dirname, "codes.json");

// tokenMap[token] = { img, exp, used }
const tokenMap = new Map();

// ====== 工具函数 ======
function safeBasename(file) {
  return path.basename(file || "");
}

function ensureCodesFile() {
  if (!fs.existsSync(CODES_FILE)) {
    const init = {
      codes: [
        { code: "CINDY-0001", used: false },
        { code: "CINDY-0002", used: false },
      ],
    };
    fs.writeFileSync(CODES_FILE, JSON.stringify(init, null, 2), "utf-8");
  }
}

function readCodes() {
  ensureCodesFile();
  const raw = fs.readFileSync(CODES_FILE, "utf-8");
  return JSON.parse(raw);
}

function writeCodes(data) {
  fs.writeFileSync(CODES_FILE, JSON.stringify(data, null, 2), "utf-8");
}

// ====== 根路径提示（你图二就是这个）======
app.get("/", (req, res) => {
  res.send("✅ Backend is running. Use /health /redeem /download");
});

// ====== 健康检查 ======
app.get("/health", (req, res) => {
  res.json({ ok: true, msg: "server is running" });
});

// ====== 兑换码验证：成功后返回一次性 token（默认 5 分钟有效）======
app.post("/redeem", (req, res) => {
  const { code, img } = req.body || {};

  if (!code || !img) {
    return res.status(400).json({ ok: false, msg: "缺少 code 或 img" });
  }

  const imgName = safeBasename(img);
  const paidImgPath = path.join(PRIVATE_IMG_DIR, imgName);

  // 1) 检查图片是否存在
  if (!fs.existsSync(paidImgPath)) {
    return res.status(404).json({
      ok: false,
      msg: `无水印原图不存在：请确认后端路径 paid/img_paid/${imgName}`,
    });
  }

  // 2) 检查兑换码
  const data = readCodes();
  const item = (data.codes || []).find((c) => c.code === code);

  if (!item) {
    return res.status(401).json({ ok: false, msg: "兑换码无效" });
  }
  if (item.used) {
    return res.status(401).json({ ok: false, msg: "兑换码已被使用" });
  }

  // 3) 标记已使用（一码一次）
  item.used = true;
  item.usedAt = new Date().toISOString();
  writeCodes(data);

  // 4) 生成一次性 token（5 分钟过期）
  const token = crypto.randomUUID();
  const exp = Date.now() + 5 * 60 * 1000;
  tokenMap.set(token, { img: imgName, exp, used: false });

  return res.json({
    ok: true,
    msg: "兑换成功！已生成下载 token（5分钟内有效，仅一次）",
    token,
  });
});

// ====== 下载无水印：必须 token + img，一次性 ======
app.get("/download", (req, res) => {
  const token = (req.query.token || "").toString();
  const img = safeBasename(req.query.img || "");

  if (!token || !img) {
    return res.status(400).send("缺少 token 或 img");
  }

  const record = tokenMap.get(token);
  if (!record) {
    return res.status(401).send("token 无效或已过期");
  }
  if (Date.now() > record.exp) {
    tokenMap.delete(token);
    return res.status(401).send("token 已过期");
  }
  if (record.used) {
    return res.status(401).send("该 token 已被使用");
  }
  if (record.img !== img) {
    return res.status(401).send("token 与图片不匹配");
  }

  const paidImgPath = path.join(PRIVATE_IMG_DIR, img);
  if (!fs.existsSync(paidImgPath)) {
    return res.status(404).send("文件不存在");
  }

  // 标记 token 已使用
  record.used = true;
  tokenMap.set(token, record);

  // 触发下载
  res.download(paidImgPath, img);
});

// ====== 启动 ======
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ PRIVATE_IMG_DIR: ${PRIVATE_IMG_DIR}`);
});

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cors = require("cors");

const app = express();
app.use(express.json());

// ✅ 调试阶段先放开跨域；稳定后把 * 改成你的前端域名
app.use(cors({ origin: "*" }));

// ====== 配置 ======
const PORT = process.env.PORT || 3000;

// ✅ 无水印图片目录（二选一）
// 方案1：后端放在 paid/img_paid/1.jpg
const PRIVATE_IMG_DIR = path.join(__dirname, "paid", "img_paid");

// 方案2：后端放在 paid/1.jpg（用这个就把上面那行注释掉）
// const PRIVATE_IMG_DIR = path.join(__dirname, "paid");

const CODES_FILE = path.join(__dirname, "codes.json");

// token 存内存：一次性、会过期
// tokenMap[token] = { img: "1.jpg", exp: 1234567890, used: false }
const tokenMap = new Map();
const TOKEN_TTL_MS = 5 * 60 * 1000; // 5分钟

// ====== 工具函数 ======
function safeBasename(file) {
  return path.basename(file || ""); // 防止 ../ 目录穿越
}

function readCodes() {
  if (!fs.existsSync(CODES_FILE)) {
    return { codes: [] };
  }
  const raw = fs.readFileSync(CODES_FILE, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { codes: [] };
  }
}

function writeCodes(data) {
  fs.writeFileSync(CODES_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function fileExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

// ====== 首页提示（可选）======
app.get("/", (req, res) => {
  res
    .status(200)
    .send("✅ Backend is running. Use /health /redeem /download");
});

// ✅ 健康检查：确认后端是否真的跑起来了
app.get("/health", (req, res) => {
  res.json({ ok: true, msg: "server is running" });
});

// ====== 兑换码验证：成功后发一个一次性 token ======
app.post("/redeem", (req, res) => {
  const { code, img } = req.body || {};

  if (!code || !img) {
    return res.status(400).json({ ok: false, msg: "缺少 code 或 img" });
  }

  const imgName = safeBasename(img);

  // 检查无水印原图是否存在（后端目录）
  const paidImgPath = path.join(PRIVATE_IMG_DIR, imgName);
  if (!fileExists(paidImgPath)) {
    return res.status(404).json({
      ok: false,
      msg: `无水印原图不存在：请确认后端路径 ${path
        .join("paid", "img_paid", imgName)
        .replaceAll("\\", "/")}（或你改成 paid/${imgName}）`,
    });
  }

  const data = readCodes();
  const item = (data.codes || []).find((c) => c.code === code);

  if (!item) {
    return res.status(401).json({ ok: false, msg: "兑换码无效" });
  }
  if (item.used) {
    return res.status(401).json({ ok: false, msg: "兑换码已被使用" });
  }

  // 标记已使用（一码一次）
  item.used = true;
  item.usedAt = new Date().toISOString();
  writeCodes(data);

  // 生成 token（5分钟过期）
  const token = crypto.randomUUID();
  const exp = Date.now() + TOKEN_TTL_MS;

  tokenMap.set(token, { img: imgName, exp, used: false });

  return res.json({
    ok: true,
    msg: "兑换成功！可下载无水印图（5分钟内有效，仅一次）",
    token,
  });
});

// ====== 下载无水印：必须带 token + img，且一次性 ======
app.get("/download", (req, res) => {
  const token = req.query.token;
  const img = safeBasename(req.query.img);

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
  if (!fileExists(paidImgPath)) {
    return res.status(404).send("文件不存在（后端找不到无水印图）");
  }

  // 标记 token 已使用（一次性）
  record.used = true;
  tokenMap.set(token, record);

  res.download(paidImgPath, img);
});

// ====== 启动 ======
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📁 PRIVATE_IMG_DIR = ${PRIVATE_IMG_DIR}`);
});

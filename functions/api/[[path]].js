const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,x-admin-token",
};

let marketplaceSchemaReady = false;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function badRequest(message) {
  return json({ error: message }, 400);
}

function normalizePath(params) {
  const value = params.path || "";
  return Array.isArray(value) ? value.join("/") : value;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function cleanText(value, max = 220) {
  return String(value || "").trim().slice(0, max);
}

function isWallet(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim());
}

function isTxHash(value) {
  return /^0x[a-fA-F0-9]{6,}$/.test(String(value || "").trim());
}

function isOptionalUrl(value) {
  const text = String(value || "").trim();
  return !text || /^https?:\/\//i.test(text);
}

function verifyProof(task, proof) {
  const text = String(proof || "").trim();
  const expected = String(task.validation_value || "").trim().toLowerCase();

  if (!text) return { status: "pending", note: "No proof submitted." };

  if (task.verification_kind === "link") {
    const looksLikeUrl = /^https?:\/\//i.test(text);
    const includesExpected = !expected || text.toLowerCase().includes(expected);
    return looksLikeUrl && includesExpected
      ? { status: "verified", note: "URL proof matched the task rule." }
      : { status: "pending", note: "URL proof needs review or does not match yet." };
  }

  if (task.verification_kind === "telegram") {
    return text.includes("@")
      ? { status: "verified", note: "Telegram username proof accepted." }
      : { status: "pending", note: "Submit a Telegram username starting with @." };
  }

  if (task.verification_kind === "tx") {
    return isTxHash(text)
      ? { status: "verified", note: "Transaction hash format accepted." }
      : { status: "pending", note: "Submit a valid transaction hash." };
  }

  if (task.verification_kind === "form") {
    return text.length >= 12
      ? { status: "verified", note: "Form response accepted." }
      : { status: "pending", note: "Form proof is too short." };
  }

  return { status: "pending", note: "Manual review required." };
}

function requireAdmin(request, env) {
  const expected = env.ADMIN_TOKEN;
  if (!expected) return { ok: false, response: json({ error: "ADMIN_TOKEN is not configured." }, 500) };

  const received = request.headers.get("x-admin-token") || "";
  if (received !== expected) return { ok: false, response: json({ error: "Unauthorized." }, 401) };

  return { ok: true };
}

async function ensureMarketplaceSchema(env) {
  if (marketplaceSchemaReady) return;
  try {
    await env.DB.prepare("ALTER TABLE tasks ADD COLUMN participant_limit INTEGER NOT NULL DEFAULT 1").run();
  } catch {
  }
  marketplaceSchemaReady = true;
}

async function listTasks(env) {
  await ensureMarketplaceSchema(env);
  const result = await env.DB.prepare(
    `SELECT
      tasks.*,
      COUNT(claims.id) AS claim_count,
      SUM(CASE WHEN claims.status = 'verified' THEN 1 ELSE 0 END) AS verified_count
    FROM tasks
    LEFT JOIN claims ON claims.task_id = tasks.id
    WHERE tasks.status = 'open'
    GROUP BY tasks.id
    ORDER BY tasks.created_at DESC, tasks.id DESC`
  ).all();

  return json({ tasks: result.results || [] });
}

async function createTask(request, env) {
  await ensureMarketplaceSchema(env);
  const body = await readJson(request);
  const title = cleanText(body.title, 90);
  const description = cleanText(body.description, 260);
  const category = cleanText(body.category, 40);
  const type = body.type === "offer" ? "offer" : "request";
  const reward = Number(body.reward || 0);
  const requestedParticipants = Number(body.participant_limit || body.participantLimit || 1);
  const participantLimit =
    type === "request" && Number.isFinite(requestedParticipants)
      ? Math.max(1, Math.min(500, Math.floor(requestedParticipants)))
      : 1;
  const ownerName = cleanText(body.owner_name || body.ownerName || "TASKTIP user", 80);
  const ownerTelegram = cleanText(body.owner_telegram || body.ownerTelegram || "", 80);
  const ownerWallet = cleanText(body.owner_wallet || body.ownerWallet || "", 80);
  const ownerContact = cleanText(body.owner_contact || body.ownerContact || body.owner || "", 120);
  const depositWallet = "0xf3542c8A751f880ed6E046881cBF1E3D707d9492";
  const creationFee = 5;
  const storedReward = type === "offer" ? 10 : Math.floor(reward);
  const totalDeposit = type === "offer" ? creationFee : storedReward * participantLimit + creationFee;
  const depositTx = cleanText(body.deposit_tx || body.depositTx || "", 120);
  const verificationKind = cleanText(body.verification_kind || body.verificationKind || "manual", 24);
  const validationValue = cleanText(body.validation_value || body.validationValue || "", 140);

  if (!title || !description || !category) return badRequest("Missing title, description or category.");
  if (type === "request" && (!Number.isFinite(reward) || reward < 10)) return badRequest("Reward must be at least 10 TASK per person.");
  if (!ownerName) return badRequest("Advertiser name is required.");
  if (ownerWallet && !isWallet(ownerWallet)) return badRequest("Owner wallet must be a valid 0x wallet.");
  if (type === "offer" && !isWallet(ownerWallet)) return badRequest("Service offers require a valid payment wallet.");
  if (!isTxHash(depositTx)) return badRequest("Valid deposit transaction hash is required.");

  const result = await env.DB.prepare(
    `INSERT INTO tasks (
      type, title, description, category, reward, participant_limit,
      owner_name, owner_telegram, owner_wallet, owner_contact,
      deposit_wallet, creation_fee, total_deposit, deposit_tx, deposit_status, status,
      verification_kind, validation_value
    )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', ?, ?)`
  )
    .bind(
      type,
      title,
      description,
      category,
      storedReward,
      participantLimit,
      ownerName,
      ownerTelegram,
      ownerWallet,
      ownerContact,
      depositWallet,
      creationFee,
      totalDeposit,
      depositTx,
      verificationKind,
      validationValue
    )
    .run();

  return json({ ok: true, id: result.meta.last_row_id }, 201);
}

async function claimTask(request, env, id) {
  await ensureMarketplaceSchema(env);
  const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
  if (!task) return json({ error: "Task not found." }, 404);
  if (task.status !== "open") return badRequest("Task is not open.");
  if (task.type === "offer") return badRequest("Service offers are contact listings, not reward tasks.");

  const claimCount = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM claims WHERE task_id = ? AND status NOT IN ('rejected', 'deleted')"
  )
    .bind(id)
    .first();
  if (Number(claimCount?.count || 0) >= Number(task.participant_limit || 1)) {
    return badRequest("This task has no available spots left.");
  }

  const body = await readJson(request);
  const claimantName = cleanText(body.claimant_name || body.claimantName || "", 80);
  const claimantTelegram = cleanText(body.claimant_telegram || body.claimantTelegram || "", 80);
  const claimantChatId = cleanText(body.claimant_chat_id || body.claimantChatId || "", 80);
  const claimantWallet = cleanText(body.claimant_wallet || body.claimantWallet || "", 80);
  const claimantContact = cleanText(body.claimant_contact || body.claimantContact || "", 120);
  const proof = cleanText(body.proof, 280);
  const screenshotUrl = cleanText(body.screenshot_url || body.screenshotUrl || "", 240);
  if (!claimantName) return badRequest("Name or alias is required.");
  if (!claimantTelegram) return badRequest("Telegram contact is required.");
  if (!isWallet(claimantWallet)) return badRequest("Valid payment wallet is required.");
  if (!proof) return badRequest("Proof is required.");
  if (!isOptionalUrl(screenshotUrl)) return badRequest("Screenshot must be a valid URL.");

  const duplicate = await env.DB.prepare("SELECT id FROM claims WHERE task_id = ? AND claimant_wallet = ?")
    .bind(id, claimantWallet)
    .first();
  if (duplicate) return badRequest("This wallet already submitted proof for this task.");

  const verification = verifyProof(task, proof);
  const result = await env.DB.prepare(
    `INSERT INTO claims (
      task_id, claimant_name, claimant_telegram, claimant_chat_id, claimant_wallet, claimant_contact,
      proof, screenshot_url, status, verifier_note, verified_at
    )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'verified' THEN CURRENT_TIMESTAMP ELSE NULL END)`
  )
    .bind(
      id,
      claimantName,
      claimantTelegram,
      claimantChatId,
      claimantWallet,
      claimantContact,
      proof,
      screenshotUrl,
      verification.status,
      verification.note,
      verification.status
    )
    .run();

  return json({
    ok: true,
    claim_id: result.meta.last_row_id,
    status: verification.status,
    note: verification.note,
  });
}

async function listClaims(env, wallet) {
  const claimantWallet = cleanText(wallet, 80);
  if (!isWallet(claimantWallet)) return badRequest("Valid wallet is required.");

  const result = await env.DB.prepare(
    `SELECT claims.*, tasks.title, tasks.reward, tasks.category
     FROM claims
     JOIN tasks ON tasks.id = claims.task_id
     WHERE claims.claimant_wallet = ?
     ORDER BY claims.created_at DESC`
  )
    .bind(claimantWallet)
    .all();

  return json({ claims: result.results || [] });
}

async function getBalance(env, wallet) {
  const claimantWallet = cleanText(wallet, 80);
  if (!isWallet(claimantWallet)) return badRequest("Valid wallet is required.");

  const summary = await env.DB.prepare(
    `SELECT
      COUNT(*) AS total_claims,
      SUM(CASE WHEN claims.status = 'pending' THEN 1 ELSE 0 END) AS pending_claims,
      SUM(CASE WHEN claims.status = 'verified' THEN 1 ELSE 0 END) AS verified_claims,
      SUM(CASE WHEN claims.status = 'paid' THEN 1 ELSE 0 END) AS paid_claims,
      COALESCE(SUM(CASE WHEN claims.status = 'verified' THEN tasks.reward ELSE 0 END), 0) AS available_task,
      COALESCE(SUM(CASE WHEN claims.status = 'paid' THEN claims.paid_amount ELSE 0 END), 0) AS paid_task
     FROM claims
     JOIN tasks ON tasks.id = claims.task_id
     WHERE claims.claimant_wallet = ?`
  )
    .bind(claimantWallet)
    .first();

  const claims = await env.DB.prepare(
    `SELECT claims.*, tasks.title, tasks.reward, tasks.category
     FROM claims
     JOIN tasks ON tasks.id = claims.task_id
     WHERE claims.claimant_wallet = ?
     ORDER BY claims.created_at DESC`
  )
    .bind(claimantWallet)
    .all();

  return json({
    wallet: claimantWallet,
    minimum_withdrawal: 10,
    can_withdraw: Number(summary.available_task || 0) >= 10,
    summary: {
      total_claims: Number(summary.total_claims || 0),
      pending_claims: Number(summary.pending_claims || 0),
      verified_claims: Number(summary.verified_claims || 0),
      paid_claims: Number(summary.paid_claims || 0),
      available_task: Number(summary.available_task || 0),
      paid_task: Number(summary.paid_task || 0),
    },
    claims: claims.results || [],
  });
}

async function listAdminClaims(request, env) {
  const admin = requireAdmin(request, env);
  if (!admin.ok) return admin.response;

  const result = await env.DB.prepare(
    `SELECT claims.*, tasks.title, tasks.reward, tasks.category, tasks.owner_name, tasks.owner_telegram
     FROM claims
     JOIN tasks ON tasks.id = claims.task_id
     ORDER BY claims.created_at DESC, claims.id DESC`
  ).all();

  return json({ claims: result.results || [] });
}

async function listAdminTasks(request, env) {
  const admin = requireAdmin(request, env);
  if (!admin.ok) return admin.response;

  const result = await env.DB.prepare(
    `SELECT
      tasks.*,
      COUNT(claims.id) AS claim_count,
      SUM(CASE WHEN claims.status = 'verified' THEN 1 ELSE 0 END) AS verified_count
     FROM tasks
     LEFT JOIN claims ON claims.task_id = tasks.id
     GROUP BY tasks.id
     ORDER BY tasks.created_at DESC, tasks.id DESC`
  ).all();

  return json({ tasks: result.results || [] });
}

async function approveTaskDeposit(request, env, id) {
  const admin = requireAdmin(request, env);
  if (!admin.ok) return admin.response;

  const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
  if (!task) return json({ error: "Task not found." }, 404);

  await env.DB.prepare(
    `UPDATE tasks
     SET deposit_status = 'verified',
         status = 'open'
     WHERE id = ?`
  )
    .bind(id)
    .run();

  return json({ ok: true, id, status: "open", deposit_status: "verified" });
}

async function deleteTask(request, env, id) {
  const admin = requireAdmin(request, env);
  if (!admin.ok) return admin.response;

  const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
  if (!task) return json({ error: "Task not found." }, 404);

  await env.DB.prepare("DELETE FROM claims WHERE task_id = ?").bind(id).run();
  await env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(id).run();

  return json({ ok: true, id, status: "deleted" });
}

async function updateClaimStatus(request, env, id, status) {
  const admin = requireAdmin(request, env);
  if (!admin.ok) return admin.response;

  const claim = await env.DB.prepare("SELECT * FROM claims WHERE id = ?").bind(id).first();
  if (!claim) return json({ error: "Claim not found." }, 404);

  const body = await readJson(request);
  const note = cleanText(body.admin_note || body.adminNote || body.verifier_note || body.verifierNote || "", 220);

  await env.DB.prepare(
    `UPDATE claims
     SET status = ?,
         verifier_note = COALESCE(NULLIF(?, ''), verifier_note),
         verified_at = CASE WHEN ? = 'verified' THEN CURRENT_TIMESTAMP ELSE verified_at END
     WHERE id = ?`
  )
    .bind(status, note, status, id)
    .run();

  return json({ ok: true, id, status });
}

async function deleteClaim(request, env, id) {
  const admin = requireAdmin(request, env);
  if (!admin.ok) return admin.response;

  await env.DB.prepare("DELETE FROM claims WHERE id = ?").bind(id).run();
  return json({ ok: true, id, status: "deleted" });
}

async function sendTelegramMessage(env, chatId, message) {
  if (!env.TELEGRAM_BOT_TOKEN || !chatId) return { ok: false, skipped: true };

  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  return response.json();
}

function paymentMessage(claim, paidAmount, paymentTx) {
  const shortWallet = `${claim.claimant_wallet.slice(0, 6)}...${claim.claimant_wallet.slice(-4)}`;
  const hashLine = paymentTx ? `\nHash: ${paymentTx}` : "";
  return [
    "<b>Pago TASKTIP aprobado</b>",
    "",
    `Tarea: ${claim.title}`,
    `Usuario: ${claim.claimant_name}`,
    `Wallet: ${shortWallet}`,
    `Monto: ${Math.floor(paidAmount)} TASK${hashLine}`,
    "",
    "Gracias por participar en TASKTIP."
  ].join("\n");
}

async function markClaimPaid(request, env, id) {
  const admin = requireAdmin(request, env);
  if (!admin.ok) return admin.response;

  const claim = await env.DB.prepare(
    `SELECT claims.*, tasks.title, tasks.reward, tasks.category
     FROM claims
     JOIN tasks ON tasks.id = claims.task_id
     WHERE claims.id = ?`
  )
    .bind(id)
    .first();
  if (!claim) return json({ error: "Claim not found." }, 404);

  const body = await readJson(request);
  const paidAmount = Number(body.paid_amount || body.paidAmount || 0);
  const paymentTx = cleanText(body.payment_tx || body.paymentTx || "", 120);
  const adminNote = cleanText(body.admin_note || body.adminNote || "", 220);

  if (!Number.isFinite(paidAmount) || paidAmount < 10) {
    return badRequest("Paid amount must be at least 10 TASK.");
  }

  await env.DB.prepare(
    `UPDATE claims
     SET status = 'paid',
         paid_amount = ?,
         payment_tx = ?,
         admin_note = ?,
         paid_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(Math.floor(paidAmount), paymentTx, adminNote, id)
    .run();

  const message = paymentMessage(claim, paidAmount, paymentTx);
  const telegramTargets = [claim.claimant_chat_id, env.TELEGRAM_PAYMENTS_CHAT_ID].filter(Boolean);
  const telegram = [];
  for (const chatId of telegramTargets) {
    telegram.push(await sendTelegramMessage(env, chatId, message));
  }

  return json({ ok: true, id, status: "paid", telegram });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: jsonHeaders });
  if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 500);

  const url = new URL(request.url);
  const path = normalizePath(params);
  const parts = path.split("/").filter(Boolean);

  try {
    if (request.method === "GET" && path === "tasks") return listTasks(env);
    if (request.method === "POST" && path === "tasks") return createTask(request, env);
    if (request.method === "POST" && parts[0] === "tasks" && parts[2] === "claim") {
      return claimTask(request, env, Number(parts[1]));
    }
    if (request.method === "GET" && path === "claims") {
      return listClaims(env, url.searchParams.get("wallet"));
    }
    if (request.method === "GET" && path === "balance") {
      return getBalance(env, url.searchParams.get("wallet"));
    }
    if (request.method === "GET" && path === "admin/claims") return listAdminClaims(request, env);
    if (request.method === "GET" && path === "admin/tasks") return listAdminTasks(request, env);
    if (request.method === "POST" && parts[0] === "admin" && parts[1] === "tasks" && parts[3] === "approve") {
      return approveTaskDeposit(request, env, Number(parts[2]));
    }
    if (request.method === "POST" && parts[0] === "admin" && parts[1] === "tasks" && parts[3] === "delete") {
      return deleteTask(request, env, Number(parts[2]));
    }
    if (request.method === "POST" && parts[0] === "admin" && parts[1] === "claims" && parts[3] === "verify") {
      return updateClaimStatus(request, env, Number(parts[2]), "verified");
    }
    if (request.method === "POST" && parts[0] === "admin" && parts[1] === "claims" && parts[3] === "reject") {
      return updateClaimStatus(request, env, Number(parts[2]), "rejected");
    }
    if (request.method === "POST" && parts[0] === "admin" && parts[1] === "claims" && parts[3] === "delete") {
      return deleteClaim(request, env, Number(parts[2]));
    }
    if (request.method === "POST" && parts[0] === "admin" && parts[1] === "claims" && parts[3] === "pay") {
      return markClaimPaid(request, env, Number(parts[2]));
    }

    return json({ error: "Route not found." }, 404);
  } catch (error) {
    return json({ error: "Server error.", detail: error.message }, 500);
  }
}

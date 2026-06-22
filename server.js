const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");

require("dotenv").config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "troque-isso-em-producao";

app.use(cors());
app.use(express.json({ limit: "10mb" })); // para aceitar foto em base64

// ─── Middleware de autenticação ────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ erro: "Token não fornecido" });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ erro: "Token inválido ou expirado" });
  }
}

function adminAuth(req, res, next) {
  auth(req, res, () => {
    if (!req.usuario.admin) return res.status(403).json({ erro: "Acesso restrito a admins" });
    next();
  });
}

// ─── Utilitários ──────────────────────────────────────────────────────────────
function semanaISO(data) {
  const d = new Date(data);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const semana1 = new Date(d.getFullYear(), 0, 4);
  const num = 1 + Math.round(((d - semana1) / 86400000 - 3 + ((semana1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(num).padStart(2, "0")}`;
}

// ─── ROTA: Health check ────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "Maví Fit API rodando ✅" }));

// ─── ROTA: Cadastro ────────────────────────────────────────────────────────────
// POST /auth/cadastro
app.post("/auth/cadastro", async (req, res) => {
  try {
    const { nome, email, senha, aceiteLgpd, linkCodigo } = req.body;

    if (!nome || !email || !senha) return res.status(400).json({ erro: "Nome, e-mail e senha são obrigatórios" });
    if (!aceiteLgpd) return res.status(400).json({ erro: "É necessário aceitar a política de dados" });
    if (senha.length < 6) return res.status(400).json({ erro: "Senha deve ter pelo menos 6 caracteres" });

    // verifica se o link da competição é válido
    const competicao = await prisma.competicao.findUnique({ where: { linkCodigo } });
    if (!competicao || !competicao.ativa) {
      return res.status(400).json({ erro: "Link de competição inválido ou encerrado" });
    }

    // verifica e-mail duplicado
    const existe = await prisma.usuario.findUnique({ where: { email } });
    if (existe) return res.status(409).json({ erro: "Este e-mail já está cadastrado" });

    const senhaHash = await bcrypt.hash(senha, 10);

    const usuario = await prisma.usuario.create({
      data: { nome, email, senha: senhaHash, aceiteLgpd: true },
    });

    const token = jwt.sign({ id: usuario.id, nome: usuario.nome, admin: usuario.admin }, JWT_SECRET, { expiresIn: "30d" });

    res.status(201).json({ token, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro interno no servidor" });
  }
});

// ─── ROTA: Login ──────────────────────────────────────────────────────────────
// POST /auth/login
app.post("/auth/login", async (req, res) => {
  try {
    const { email, senha } = req.body;
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    if (!usuario) return res.status(401).json({ erro: "E-mail ou senha incorretos" });

    const senhaOk = await bcrypt.compare(senha, usuario.senha);
    if (!senhaOk) return res.status(401).json({ erro: "E-mail ou senha incorretos" });

    const token = jwt.sign({ id: usuario.id, nome: usuario.nome, admin: usuario.admin }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, admin: usuario.admin } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro interno no servidor" });
  }
});

// ─── ROTA: Feed ───────────────────────────────────────────────────────────────
// GET /feed?competicaoId=xxx&pagina=1
app.get("/feed", auth, async (req, res) => {
  try {
    const { competicaoId, pagina = 1 } = req.query;
    const porPagina = 20;

    const checkins = await prisma.checkin.findMany({
      where: { competicaoId, status: "aprovado" },
      include: {
        usuario: { select: { id: true, nome: true } },
        curtidas: true,
        comentarios: { orderBy: { criadoEm: "asc" } },
      },
      orderBy: { criadoEm: "desc" },
      skip: (pagina - 1) * porPagina,
      take: porPagina,
    });

    const resultado = checkins.map(c => ({
      id: c.id,
      usuario: c.usuario,
      atividade: c.atividade,
      duracaoMinutos: c.duracaoMinutos,
      fotoUrl: c.fotoUrl,
      legenda: c.legenda,
      criadoEm: c.criadoEm,
      curtidas: c.curtidas.length,
      curtiuEu: c.curtidas.some(cu => cu.usuarioId === req.usuario.id),
      comentarios: c.comentarios.map(cm => ({ id: cm.id, nome: cm.nomeUsuario, texto: cm.texto })),
    }));

    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao carregar feed" });
  }
});

// ─── ROTA: Novo check-in ──────────────────────────────────────────────────────
// POST /checkins
app.post("/checkins", auth, async (req, res) => {
  try {
    const { competicaoId, fotoBase64, atividade, duracaoMinutos, legenda } = req.body;

    if (!fotoBase64 || !atividade) return res.status(400).json({ erro: "Foto e atividade são obrigatórios" });

    const cardio = ["Corrida", "Ciclismo", "Natação", "Caminhada"];
    if (cardio.includes(atividade) && (!duracaoMinutos || duracaoMinutos < 30)) {
      return res.status(400).json({ erro: "Atividades de cardio exigem mínimo 30 minutos" });
    }

    // verifica se já fez check-in hoje
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const amanha = new Date(hoje);
    amanha.setDate(amanha.getDate() + 1);

    const checkinHoje = await prisma.checkin.findFirst({
      where: {
        usuarioId: req.usuario.id,
        competicaoId,
        criadoEm: { gte: hoje, lt: amanha },
        status: { not: "reprovado" },
      },
    });

    if (checkinHoje) return res.status(409).json({ erro: "Você já fez check-in hoje. Apenas 1 por dia é permitido." });

    // --- aqui você integra o upload da foto para Cloudinary ---
    // const fotoUrl = await uploadCloudinary(fotoBase64);
    const fotoUrl = "https://placeholder.mavifit.app/foto.jpg"; // substituir por Cloudinary

    const semana = semanaISO(new Date());

    const checkin = await prisma.checkin.create({
      data: {
        usuarioId: req.usuario.id,
        competicaoId,
        fotoUrl,
        atividade,
        duracaoMinutos: duracaoMinutos || null,
        legenda: legenda || null,
        dataFoto: new Date(),
        semanaReferencia: semana,
        status: "pendente",
      },
    });

    res.status(201).json({ checkin, mensagem: "Check-in enviado! Aguardando aprovação." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao registrar check-in" });
  }
});

// ─── ROTA: Curtir / descurtir ─────────────────────────────────────────────────
// POST /checkins/:id/curtir
app.post("/checkins/:id/curtir", auth, async (req, res) => {
  try {
    const existe = await prisma.curtida.findUnique({
      where: { checkinId_usuarioId: { checkinId: req.params.id, usuarioId: req.usuario.id } },
    });

    if (existe) {
      await prisma.curtida.delete({ where: { id: existe.id } });
      res.json({ curtiu: false });
    } else {
      await prisma.curtida.create({ data: { checkinId: req.params.id, usuarioId: req.usuario.id } });
      res.json({ curtiu: true });
    }
  } catch (err) {
    res.status(500).json({ erro: "Erro ao curtir" });
  }
});

// ─── ROTA: Comentar ───────────────────────────────────────────────────────────
// POST /checkins/:id/comentarios
app.post("/checkins/:id/comentarios", auth, async (req, res) => {
  try {
    const { texto } = req.body;
    if (!texto?.trim()) return res.status(400).json({ erro: "Comentário vazio" });

    const comentario = await prisma.comentario.create({
      data: {
        checkinId: req.params.id,
        usuarioId: req.usuario.id,
        nomeUsuario: req.usuario.nome,
        texto: texto.trim(),
      },
    });

    res.status(201).json(comentario);
  } catch (err) {
    res.status(500).json({ erro: "Erro ao comentar" });
  }
});

// ─── ROTA: Meu progresso na semana ────────────────────────────────────────────
// GET /meu-progresso?competicaoId=xxx
app.get("/meu-progresso", auth, async (req, res) => {
  try {
    const { competicaoId } = req.query;
    const semanaAtual = semanaISO(new Date());

    const checkinsSemana = await prisma.checkin.count({
      where: {
        usuarioId: req.usuario.id,
        competicaoId,
        semanaReferencia: semanaAtual,
        status: "aprovado",
      },
    });

    const totalTickets = await prisma.ticket.count({
      where: { usuarioId: req.usuario.id, competicaoId },
    });

    const meusTickets = await prisma.ticket.findMany({
      where: { usuarioId: req.usuario.id, competicaoId },
      orderBy: { numero: "asc" },
      select: { numero: true, semanaReferencia: true },
    });

    res.json({ checkinsSemana, totalTickets, tickets: meusTickets });
  } catch (err) {
    res.status(500).json({ erro: "Erro ao buscar progresso" });
  }
});

// ─── ROTA: Ranking ────────────────────────────────────────────────────────────
// GET /ranking?competicaoId=xxx
app.get("/ranking", auth, async (req, res) => {
  try {
    const { competicaoId } = req.query;

    const usuarios = await prisma.usuario.findMany({
      include: {
        tickets: { where: { competicaoId } },
        checkins: { where: { competicaoId, status: "aprovado" } },
      },
    });

    const ranking = usuarios
      .map(u => ({
        id: u.id,
        nome: u.nome,
        totalTickets: u.tickets.length,
        totalCheckins: u.checkins.length,
      }))
      .filter(u => u.totalCheckins > 0)
      .sort((a, b) => b.totalTickets - a.totalTickets);

    res.json(ranking);
  } catch (err) {
    res.status(500).json({ erro: "Erro ao buscar ranking" });
  }
});

// ─── ROTA ADMIN: Aprovar / reprovar check-in ──────────────────────────────────
// PATCH /admin/checkins/:id
app.patch("/admin/checkins/:id", adminAuth, async (req, res) => {
  try {
    const { status, motivoRejeicao } = req.body; // status: "aprovado" | "reprovado"

    const checkin = await prisma.checkin.update({
      where: { id: req.params.id },
      data: { status, motivoRejeicao: motivoRejeicao || null },
    });

    // se aprovado: verifica se o usuário completou 3 check-ins na semana e gera tickets
    if (status === "aprovado") {
      const aprovadosSemana = await prisma.checkin.count({
        where: {
          usuarioId: checkin.usuarioId,
          competicaoId: checkin.competicaoId,
          semanaReferencia: checkin.semanaReferencia,
          status: "aprovado",
        },
      });

      if (aprovadosSemana === 3) {
        // verifica se já gerou tickets para esta semana
        const ticketsJaGerados = await prisma.ticket.count({
          where: {
            usuarioId: checkin.usuarioId,
            competicaoId: checkin.competicaoId,
            semanaReferencia: checkin.semanaReferencia,
          },
        });

        if (ticketsJaGerados === 0) {
          // busca o maior número de ticket global e gera 3 sequenciais
          const ultimo = await prisma.ticket.findFirst({ orderBy: { numero: "desc" } });
          const proximo = (ultimo?.numero || 0) + 1;

          await prisma.ticket.createMany({
            data: [
              { numero: proximo,     usuarioId: checkin.usuarioId, competicaoId: checkin.competicaoId, semanaReferencia: checkin.semanaReferencia },
              { numero: proximo + 1, usuarioId: checkin.usuarioId, competicaoId: checkin.competicaoId, semanaReferencia: checkin.semanaReferencia },
              { numero: proximo + 2, usuarioId: checkin.usuarioId, competicaoId: checkin.competicaoId, semanaReferencia: checkin.semanaReferencia },
            ],
          });

          return res.json({ checkin, ticketsGerados: [proximo, proximo + 1, proximo + 2], mensagem: "✅ 3 tickets únicos gerados!" });
        }
      }
    }

    res.json({ checkin, mensagem: `Check-in ${status}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao processar check-in" });
  }
});

// ─── ROTA ADMIN: Listar check-ins pendentes ───────────────────────────────────
// GET /admin/checkins/pendentes?competicaoId=xxx
app.get("/admin/checkins/pendentes", adminAuth, async (req, res) => {
  try {
    const { competicaoId } = req.query;
    const checkins = await prisma.checkin.findMany({
      where: { competicaoId, status: "pendente" },
      include: { usuario: { select: { id: true, nome: true } } },
      orderBy: { criadoEm: "asc" },
    });
    res.json(checkins);
  } catch (err) {
    res.status(500).json({ erro: "Erro ao buscar pendentes" });
  }
});

// ─── ROTA ADMIN: Relatório do semestre ───────────────────────────────────────
// GET /admin/relatorio?competicaoId=xxx
app.get("/admin/relatorio", adminAuth, async (req, res) => {
  try {
    const { competicaoId } = req.query;

    const totalParticipantes = await prisma.usuario.count();
    const totalCheckins = await prisma.checkin.count({ where: { competicaoId, status: "aprovado" } });
    const totalTickets = await prisma.ticket.count({ where: { competicaoId } });

    const semanaAtual = semanaISO(new Date());
    const ativosEstaSemana = await prisma.checkin.groupBy({
      by: ["usuarioId"],
      where: { competicaoId, semanaReferencia: semanaAtual, status: "aprovado" },
    });

    // top 10 por tickets
    const top10 = await prisma.usuario.findMany({
      include: { tickets: { where: { competicaoId } }, checkins: { where: { competicaoId, status: "aprovado" } } },
      take: 10,
    });

    res.json({
      totalParticipantes,
      totalCheckins,
      totalTickets,
      ativosEstaSemana: ativosEstaSemana.length,
      top10: top10.map(u => ({ nome: u.nome, tickets: u.tickets.length, checkins: u.checkins.length }))
        .sort((a, b) => b.tickets - a.tickets),
    });
  } catch (err) {
    res.status(500).json({ erro: "Erro ao gerar relatório" });
  }
});

// ─── ROTA ADMIN: Criar competição ────────────────────────────────────────────
// POST /admin/competicoes
app.post("/admin/competicoes", adminAuth, async (req, res) => {
  try {
    const { nome, descricao, inicio, fim, premio } = req.body;
    const linkCodigo = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

    const competicao = await prisma.competicao.create({
      data: { nome, descricao, inicio: new Date(inicio), fim: new Date(fim), premio: premio || 1200, linkCodigo },
    });

    res.status(201).json({ competicao, link: `mavift.app/entrar/${linkCodigo}` });
  } catch (err) {
    res.status(500).json({ erro: "Erro ao criar competição" });
  }
});

app.listen(PORT, () => console.log(`🚀 Maví Fit API rodando na porta ${PORT}`));

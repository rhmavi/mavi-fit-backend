# 🚀 Guia de Deploy — Maví Fit Backend

Siga este guia para colocar o backend no ar em menos de 30 minutos,
sem precisar de time de TI. Tudo gratuito ou barato.

---

## Pré-requisitos (crie as contas antes)

| Serviço | Para quê | Plano gratuito? |
|---------|----------|-----------------|
| [railway.app](https://railway.app) | Servidor + banco de dados | ✅ Starter grátis |
| [cloudinary.com](https://cloudinary.com) | Armazenar as fotos | ✅ 25GB grátis |
| [github.com](https://github.com) | Hospedar o código | ✅ Sempre grátis |

---

## Passo 1 — Subir o código no GitHub

1. Crie uma conta em github.com se não tiver
2. Clique em "New repository" → nome: `mavi-fit-backend` → Create
3. Faça upload de todos os arquivos desta pasta para o repositório

---

## Passo 2 — Criar o banco de dados no Railway

1. Acesse [railway.app](https://railway.app) e clique em **New Project**
2. Escolha **Deploy PostgreSQL**
3. Após criar, clique no banco → aba **Variables**
4. Copie o valor de `DATABASE_URL`

---

## Passo 3 — Deploy do servidor no Railway

1. No mesmo projeto, clique em **New Service → GitHub Repo**
2. Conecte sua conta GitHub e selecione `mavi-fit-backend`
3. O Railway vai detectar o Node.js automaticamente

**Adicione as variáveis de ambiente** (aba Variables do serviço):

```
DATABASE_URL     = (cole o valor copiado no passo 2)
JWT_SECRET       = (gere uma string aleatória em randomkeygen.com)
CLOUDINARY_CLOUD_NAME = (do passo 4)
CLOUDINARY_API_KEY    = (do passo 4)
CLOUDINARY_API_SECRET = (do passo 4)
```

4. Na aba **Settings → Start Command**, coloque:
   ```
   npx prisma migrate deploy && node server.js
   ```

5. Clique em **Deploy** — em ~2 minutos a API estará no ar

6. Copie a URL gerada (ex: `mavi-fit.up.railway.app`) — esta é a sua API

---

## Passo 4 — Configurar Cloudinary (fotos)

1. Crie conta em [cloudinary.com](https://cloudinary.com)
2. No dashboard, copie: **Cloud Name**, **API Key**, **API Secret**
3. Cole nas variáveis de ambiente do Railway (passo 3)

---

## Passo 5 — Criar o admin e a primeira competição

Com a API no ar, faça estas chamadas (pode usar o Insomnia ou Postman):

**1. Crie o usuário admin** (edite o script abaixo e rode no terminal):
```bash
curl -X POST https://SUA-URL.railway.app/auth/cadastro \
  -H "Content-Type: application/json" \
  -d '{
    "nome": "Admin RH Maví",
    "email": "rh@mavi.com.br",
    "senha": "SuaSenhaAqui",
    "aceiteLgpd": true,
    "linkCodigo": "qualquer"
  }'
```

**2. Manualmente no banco** (Railway → banco → Data), coloque `admin = true`
   para o usuário que você criou.

**3. Crie a competição** (use o token do login):
```bash
curl -X POST https://SUA-URL.railway.app/admin/competicoes \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "nome": "Maví Fit 2º Semestre 2026",
    "inicio": "2026-07-01",
    "fim": "2026-12-31",
    "premio": 1200
  }'
```

A resposta vai incluir o `link` para compartilhar com os funcionários.

---

## Rotas disponíveis na API

### Públicas
| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/auth/cadastro` | Cadastro via link |
| POST | `/auth/login` | Login |

### Autenticadas (precisa do token no header)
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/feed` | Feed de atividades |
| POST | `/checkins` | Novo check-in |
| POST | `/checkins/:id/curtir` | Curtir/descurtir |
| POST | `/checkins/:id/comentarios` | Comentar |
| GET | `/meu-progresso` | Check-ins e tickets da semana |
| GET | `/ranking` | Ranking da competição |

### Admin (precisa ser admin)
| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/admin/checkins/pendentes` | Check-ins aguardando aprovação |
| PATCH | `/admin/checkins/:id` | Aprovar ou reprovar |
| GET | `/admin/relatorio` | Relatório completo |
| POST | `/admin/competicoes` | Criar nova competição |

---

## Custo estimado (200 funcionários)

| Serviço | Custo/mês |
|---------|-----------|
| Railway (servidor + banco) | R$ 30–60 |
| Cloudinary (fotos) | Grátis até 25GB |
| **Total** | **~R$ 50/mês** |

---

## Suporte

Em caso de dúvidas, abra o Claude e cole a mensagem de erro.
O código está todo documentado e pode ser ajustado a qualquer momento.

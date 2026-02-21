# ============ 阶段1: 构建前端 ============
FROM node:20-alpine AS frontend-builder

WORKDIR /app/web

# 先复制 package.json 利用 Docker 缓存
COPY web/package.json ./
RUN npm install

# 复制前端源码并构建
COPY web/ ./
RUN npm run build

# ============ 阶段2: 生产运行 ============
FROM node:20-alpine

WORKDIR /app

# 复制后端 package.json 并安装依赖
COPY package.json ./
RUN npm install --omit=dev

# 复制后端源码 & 配置
COPY server/ ./server/
COPY src/ ./src/
COPY proto/ ./proto/
COPY gameConfig/ ./gameConfig/

# 从阶段1复制前端构建产物
COPY --from=frontend-builder /app/web/dist ./web/dist

# 创建数据目录（用于挂载）
RUN mkdir -p /app/data

# 默认端口
EXPOSE 3000

# 环境变量（可在 docker-compose 或 docker run 中覆盖）
ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", "server/index.js"]

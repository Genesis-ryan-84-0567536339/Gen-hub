ARG NODE_IMAGE=node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e
FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3080 DATA_DIR=/data
COPY --chown=root:root package.json ./
COPY --chown=root:root server ./server
COPY --chown=root:root public ./public
USER node
EXPOSE 3080
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 CMD ["node", "server/healthcheck.mjs"]
CMD ["node", "server/main.mjs"]

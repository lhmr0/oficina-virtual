# Oficina Virtual (servidor central para el VPS). Los agentes NO corren aquí: los ejecuta el agente de campo en la PC.
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production OFICINA_DATA=/data OFICINA_BIND=0.0.0.0 OFICINA_PORT=4242 OFICINA_LOCAL_EXEC=0
# uid 1000 (node) = dueño de ~/oficina/data en el VPS
USER node
EXPOSE 4242
CMD ["node", "--no-warnings", "server.js"]

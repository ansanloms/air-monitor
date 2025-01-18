FROM docker.io/denoland/deno:2.1.6

WORKDIR /app
EXPOSE 8000

COPY deno.json /app/
COPY deno.lock /app/
COPY server.ts /app/
COPY lib/ /app/lib/

RUN deno cache server.ts

CMD ["serve", "-A", "--port", "8000", "server.ts"]

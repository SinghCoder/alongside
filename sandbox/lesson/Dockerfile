FROM node:22-alpine
RUN apk add --no-cache bash python3 py3-pillow ffmpeg ripgrep ca-certificates font-dejavu
RUN npm install -g tsx@4.20.5 typescript@5.9.2
WORKDIR /workspace
ENV HOME=/workspace TMPDIR=/tmp
CMD ["sleep", "infinity"]

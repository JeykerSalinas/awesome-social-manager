SHELL := /bin/bash

.PHONY: install build build-core test typecheck dev dev-api dev-worker dev-web docker-up docker-build docker-down docker-logs

install:
	npm install

build:
	npm run build

build-core:
	npm run build -w @asm/core

test:
	npm test

typecheck:
	npm run typecheck

dev: build-core
	$(MAKE) -j3 dev-api dev-worker dev-web

dev-api:
	npm run dev -w @asm/api

dev-worker:
	npm run dev -w @asm/worker

dev-web:
	npm run dev:web

docker-up:
	docker compose up

docker-build:
	docker compose up --build

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

# Makefile for eCloud SDK and CLI

.PHONY: help install clean build test lint format typecheck ci-check
.PHONY: version prepare publish dry-run validate-version show-versions info
.PHONY: build-sdk build-cli

.DEFAULT_GOAL := help

# Build configuration
PACKAGE_VERSION ?= 0.0.1-dev.local
BUILD_TYPE ?= dev
NPM_TAG ?= dev
SHORT_SHA ?= local
NODE_ENV ?= production

SDK_DIR := packages/sdk
CLI_DIR := packages/cli

# Terminal colors
CYAN := \033[0;36m
GREEN := \033[0;32m
RED := \033[0;31m
YELLOW := \033[0;33m
NC := \033[0m

##@ General

help: ## Display this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

info: ## Show build environment information
	@echo "$(CYAN)Build Environment:$(NC)"
	@echo "  Node:     $$(node --version)"
	@echo "  pnpm:     $$(pnpm --version)"
	@echo "  Type:     $(BUILD_TYPE)"
	@echo "  Version:  $(PACKAGE_VERSION)"
	@echo "  Tag:      $(NPM_TAG)"
	@echo "  SHA:      $(SHORT_SHA)"

##@ Dependencies

install: ## Install all dependencies
	@echo "$(CYAN)Installing dependencies...$(NC)"
	@pnpm install --frozen-lockfile

clean: ## Clean build artifacts and node_modules
	@echo "$(CYAN)Cleaning...$(NC)"
	@rm -rf $(SDK_DIR)/dist
	@rm -rf $(CLI_DIR)/dist
	@rm -f $(SDK_DIR)/VERSION
	@rm -f $(CLI_DIR)/VERSION
	@rm -f $(SDK_DIR)/README.md
	@rm -f $(CLI_DIR)/README.md
	@echo "$(GREEN)Done$(NC)"

clean-all: clean ## Clean everything including node_modules
	@rm -rf node_modules
	@rm -rf $(SDK_DIR)/node_modules
	@rm -rf $(CLI_DIR)/node_modules
	@echo "$(GREEN)All clean$(NC)"

##@ Code Quality

lint: ## Run linter on all packages
	@pnpm run lint

format: ## Check code formatting
	@pnpm run format

format-fix: ## Fix code formatting issues
	@pnpm run format:fix

typecheck: ## Run TypeScript type checking
	@pnpm run typecheck

test: ## Run tests
	@pnpm run test

ci-check: lint format typecheck ## Run all CI checks (lint, format, typecheck)
	@echo "$(GREEN)CI checks passed$(NC)"

##@ Build

build-sdk: ## Build SDK package
	@echo "$(CYAN)Building SDK ($(BUILD_TYPE))...$(NC)"
	@cd $(SDK_DIR) && \
		BUILD_TYPE=$(BUILD_TYPE) \
		PACKAGE_VERSION=$(PACKAGE_VERSION) \
		POSTHOG_API_KEY_BUILD_TIME=$(POSTHOG_API_KEY_BUILD_TIME) \
		pnpm run build

build-cli: build-sdk ## Build CLI package (depends on SDK)
	@echo "$(CYAN)Building CLI ($(BUILD_TYPE))...$(NC)"
	@cd $(CLI_DIR) && \
		BUILD_TYPE=$(BUILD_TYPE) \
		PACKAGE_VERSION=$(PACKAGE_VERSION) \
		POSTHOG_API_KEY_BUILD_TIME=$(POSTHOG_API_KEY_BUILD_TIME) \
		pnpm run build

build: build-cli ## Build all packages (SDK + CLI)
	@echo "$(GREEN)Build complete$(NC)"

##@ Version Management

version: ## Generate VERSION files for both packages
	@echo "$(CYAN)Generating VERSION files...$(NC)"
	@cd $(SDK_DIR) && \
		PACKAGE_VERSION=$(PACKAGE_VERSION) \
		GITHUB_SHA=$(SHORT_SHA) \
		node scripts/generate-version.js
	@cd $(CLI_DIR) && \
		PACKAGE_VERSION=$(PACKAGE_VERSION) \
		GITHUB_SHA=$(SHORT_SHA) \
		node scripts/generate-version.js

validate-version: ## Validate version format
	@echo "Validating version: $(PACKAGE_VERSION)"
	@if echo "$(PACKAGE_VERSION)" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+'; then \
		echo "$(GREEN)Valid version format$(NC)"; \
	else \
		echo "$(RED)Invalid version: $(PACKAGE_VERSION)$(NC)"; \
		echo "Expected format: x.y.z or x.y.z-prerelease"; \
		exit 1; \
	fi

show-versions: ## Show current package versions
	@echo "$(CYAN)Package Versions:$(NC)"
	@echo "  SDK: $$(cd $(SDK_DIR) && node -p "require('./package.json').version")"
	@echo "  CLI: $$(cd $(CLI_DIR) && node -p "require('./package.json').version")"
	@if [ -f "$(SDK_DIR)/VERSION" ]; then \
		echo "  SDK VERSION file: $$(cat $(SDK_DIR)/VERSION)"; \
	fi
	@if [ -f "$(CLI_DIR)/VERSION" ]; then \
		echo "  CLI VERSION file: $$(cat $(CLI_DIR)/VERSION)"; \
	fi
	@echo ""
	@echo "Build config: $(PACKAGE_VERSION) ($(BUILD_TYPE), tag=$(NPM_TAG))"

##@ Publishing

prepare: ## Prepare packages for publishing (update versions and dependencies)
	@echo "$(CYAN)Preparing packages...$(NC)"
	@echo "Setting version to $(PACKAGE_VERSION)"
	@cd $(SDK_DIR) && npm pkg set version="$(PACKAGE_VERSION)"
	@cd $(CLI_DIR) && npm pkg set version="$(PACKAGE_VERSION)"
	@cd $(CLI_DIR) && npm pkg set "dependencies.@layr-labs/ecloud-sdk"="$(PACKAGE_VERSION)"
	@echo ""
	@echo "SDK:"
	@cd $(SDK_DIR) && cat package.json | grep -A 2 '"name"'
	@echo ""
	@echo "CLI:"
	@cd $(CLI_DIR) && cat package.json | grep -A 2 '"name"'
	@cd $(CLI_DIR) && cat package.json | grep -A 1 '"@layr-labs/ecloud-sdk"'
	@echo ""
	@echo "$(GREEN)Ready to publish$(NC)"

dry-run: ## Show what would be published without actually publishing
	@echo "$(YELLOW)DRY RUN - Nothing will be published$(NC)"
	@echo ""
	@echo "Config:"
	@echo "  Version: $(PACKAGE_VERSION)"
	@echo "  Type:    $(BUILD_TYPE)"
	@echo "  Tag:     $(NPM_TAG)"
	@echo "  SHA:     $(SHORT_SHA)"
	@echo ""
	@echo "Would publish:"
	@echo "  - @layr-labs/ecloud-sdk@$(PACKAGE_VERSION)"
	@echo "  - @layr-labs/ecloud-cli@$(PACKAGE_VERSION)"
	@echo ""
	@echo "To publish: make publish PACKAGE_VERSION=$(PACKAGE_VERSION) NPM_TAG=$(NPM_TAG)"
	@echo ""

publish: ## Publish packages to npm
	@echo "$(CYAN)Publishing to npm...$(NC)"
	@echo "Publishing SDK (tag=$(NPM_TAG))"
	@cd $(SDK_DIR) && npm publish --tag $(NPM_TAG) --access public
	@echo "Publishing CLI (tag=$(NPM_TAG))"
	@cd $(CLI_DIR) && npm publish --tag $(NPM_TAG) --access public
	@echo ""
	@echo "$(GREEN)Published:$(NC)"
	@echo "  @layr-labs/ecloud-sdk@$(PACKAGE_VERSION)"
	@echo "  @layr-labs/ecloud-cli@$(PACKAGE_VERSION)"
	@echo ""
	@if [ "$(NPM_TAG)" = "latest" ]; then \
		echo "Install: npm install -g @layr-labs/ecloud-cli"; \
	else \
		echo "Install: npm install -g @layr-labs/ecloud-cli@$(NPM_TAG)"; \
	fi
	@echo ""

##@ Local Development

dev-build: ## Quick build for local development
	@$(MAKE) build BUILD_TYPE=dev PACKAGE_VERSION=0.0.1-dev.local

dev-install: install dev-build ## Install and build for local development
	@echo "$(GREEN)Dev environment ready$(NC)"

dev-test: ci-check test ## Run all checks and tests
	@echo "$(GREEN)All checks passed$(NC)"

##@ Release Workflows

release-dev: ## Complete dev release workflow (build, version, prepare)
	@$(MAKE) validate-version PACKAGE_VERSION=$(PACKAGE_VERSION)
	@$(MAKE) install
	@$(MAKE) ci-check
	@$(MAKE) build BUILD_TYPE=dev
	@$(MAKE) version
	@$(MAKE) prepare
	@$(MAKE) show-versions
	@echo "$(GREEN)Ready to publish dev release$(NC)"

release-prod: ## Complete prod release workflow (build, version, prepare)
	@$(MAKE) validate-version PACKAGE_VERSION=$(PACKAGE_VERSION)
	@$(MAKE) install
	@$(MAKE) ci-check
	@$(MAKE) build BUILD_TYPE=prod
	@$(MAKE) version
	@$(MAKE) prepare
	@$(MAKE) show-versions
	@echo "$(GREEN)Ready to publish production release$(NC)"

##@ Documentation

docs: ## Generate documentation
	@echo "$(YELLOW)Documentation generation not implemented yet$(NC)"

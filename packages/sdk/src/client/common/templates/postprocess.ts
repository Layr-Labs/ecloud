/**
 * Template post-processing
 *
 * Updates template files with project-specific values
 */

import * as fs from "fs";
import * as path from "path";
import { Logger } from "../types";
import { TemplateEntry } from "./catalog";
import { getDirname } from "../utils/dirname";

// Config file paths
const __dirname = getDirname();
const CONFIG_DIR = path.join(__dirname, "../../config");

/**
 * Post-process template files
 */
export async function postProcessTemplate(
  projectDir: string,
  language: string,
  templateEntry: TemplateEntry,
  logger: Logger,
): Promise<void> {
  const projectName = path.basename(projectDir);
  const templateName = `eigenx-tee-${language}-app`;

  // 1. Copy .gitignore
  await copyGitignore(projectDir);

  // 2. Copy shared template files (.env.example, README.md)
  await copySharedTemplateFiles(projectDir);

  // 3. Get files to update from template metadata, fallback to just README.md
  const filesToUpdate = templateEntry.postProcess?.replaceNameIn || ["README.md"];

  // 4. Update all files specified in template metadata
  for (const filename of filesToUpdate) {
    await updateProjectFile(projectDir, filename, templateName, projectName, logger);
  }
}

/**
 * Copy .gitignore from config
 */
async function copyGitignore(projectDir: string): Promise<void> {
  const destPath = path.join(projectDir, ".gitignore");

  // Check if .gitignore already exists
  if (fs.existsSync(destPath)) {
    return; // File already exists, skip copying
  }

  // Load from config directory
  const gitignorePath = path.join(CONFIG_DIR, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    fs.copyFileSync(gitignorePath, destPath);
  } else {
    // Fallback to default gitignore content
    const defaultGitignore = `# Binaries for programs and plugins
*.exe
*.exe~
*.dll
*.so
*.dylib

# Build outputs
/bin/
/out/

# OS-specific files
.DS_Store
Thumbs.db

# Editor and IDE files
.vscode/
.idea/
*.swp

# Environment
.env

# Language-specific build outputs
node_modules/
dist/
build/
target/
__pycache__/
*.pyc
`;
    fs.writeFileSync(destPath, defaultGitignore, { mode: 0o644 });
  }
}

/**
 * Copy shared template files
 */
async function copySharedTemplateFiles(projectDir: string): Promise<void> {
  // Write .env.example
  const envPath = path.join(projectDir, ".env.example");
  const envExamplePath = path.join(CONFIG_DIR, ".env.example");
  if (fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
  } else {
    // Fallback to default .env.example
    const defaultEnvExample = `# Environment variables
# Variables ending with _PUBLIC will be visible on-chain
# All other variables will be encrypted

# Example public variable
# API_URL_PUBLIC=https://api.example.com

# Example private variable
# SECRET_KEY=your-secret-key-here
`;
    fs.writeFileSync(envPath, defaultEnvExample, { mode: 0o644 });
  }

  // Write or append README.md
  const readmePath = path.join(projectDir, "README.md");
  const readmeConfigPath = path.join(CONFIG_DIR, "README.md");

  if (fs.existsSync(readmePath)) {
    // README.md exists, append the content
    const readmeContent = fs.existsSync(readmeConfigPath)
      ? fs.readFileSync(readmeConfigPath, "utf-8")
      : getDefaultReadme();
    fs.appendFileSync(readmePath, "\n" + readmeContent);
  } else {
    // README.md doesn't exist, create it
    const readmeContent = fs.existsSync(readmeConfigPath)
      ? fs.readFileSync(readmeConfigPath, "utf-8")
      : getDefaultReadme();
    fs.writeFileSync(readmePath, readmeContent, { mode: 0o644 });
  }
}

/**
 * Get default README content
 */
function getDefaultReadme(): string {
  return `## Prerequisites

Before deploying, you'll need:

- **Docker** - To package and publish your application image
- **ETH** - To pay for deployment transactions

## Deployment

\`\`\`bash
ecloud compute app deploy username/image-name
\`\`\`

The CLI will automatically detect the \`Dockerfile\` and build your app before deploying.

## Management & Monitoring

\`\`\`bash
ecloud compute app list                    # List all apps
ecloud compute app info [app-name]         # Get app details
ecloud compute app logs [app-name]         # View logs
ecloud compute app start [app-name]        # Start stopped app
ecloud compute app stop [app-name]         # Stop running app
ecloud compute app terminate [app-name]    # Terminate app
ecloud compute app upgrade [app-name] [image] # Update deployment
\`\`\`
`;
}

/**
 * Update project file by replacing template name with project name
 */
async function updateProjectFile(
  projectDir: string,
  filename: string,
  oldString: string,
  newString: string,
  logger: Logger,
): Promise<void> {
  const filePath = path.join(projectDir, filename);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    logger.debug(`File ${filename} not found, skipping update`);
    return;
  }

  // Read current file
  const content = fs.readFileSync(filePath, "utf-8");

  // Replace the specified string
  const newContent = content.replaceAll(oldString, newString);

  // Write back to file
  fs.writeFileSync(filePath, newContent, { mode: 0o644 });
}

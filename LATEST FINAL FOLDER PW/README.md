# Graphis — a browser-first research constellation

Graphis is a free, shareable website for discovering connections between academic papers, datasets and methods at **CHRIST (Deemed to be University), Bangalore Yeshwanthpur Campus**.

The competition-ready version is static: it runs entirely in the visitor's browser and is designed for **GitHub Pages**. There is no Cloud Run bill, no API key, no server database, and no required account for visitors.

## What the public website does

- Displays an interactive, keyboard-accessible knowledge constellation.
- Searches and filters research signals by discipline.
- Reveals potential cross-disciplinary bridges and duplication signals.
- Accepts Markdown, text, CSV, selected code files, and text-readable PDFs.
- Extracts simple research signals and adds nodes and edges **only in the visitor's browser**. Uploaded material is not sent to or saved by the website.
- Opens discovered DOI candidates using the official `doi.org` resolver.

## Publish free on GitHub Pages

### 1. Create a GitHub repository

1. Go to [github.com/new](https://github.com/new).
2. Repository name: `graphis`.
3. Select **Public**.
4. Do **not** initialise it with a README, `.gitignore`, or licence.
5. Click **Create repository**.

### 2. Upload this project

On your computer, open PowerShell inside this project folder:

```powershell
cd "C:\Users\Admin\Documents\Codex\2026-08-25\problem-statement-graphis-decentralized-academic-citation"
```

If `git --version` does not show a version number, install Git once (in PowerShell as Administrator), then close and reopen PowerShell:

```powershell
choco install git -y
```

Then copy the three commands from GitHub's **“…or push an existing repository from the command line”** section. They will look like this (replace `YOUR-USERNAME` if needed):

```powershell
git init
git add .
git commit -m "Publish Graphis research constellation"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/graphis.git
git push -u origin main
```

If Git asks who you are, run these once with your own details:

```powershell
git config --global user.name "Your Name"
git config --global user.email "your-email@example.com"
```

### 3. Turn on the website

1. In the GitHub repository, open **Settings → Pages**.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. Open the **Actions** tab. The “Publish Graphis website” workflow will run automatically.
4. Once it has a green check mark, return to **Settings → Pages**.

Your public competition link will be:

```text
https://YOUR-USERNAME.github.io/graphis/
```

Use that link in your submission. GitHub Pages is free for a public repository.

## Local preview (optional)

You do not need to install Node.js just to publish the static website. To preview it before publishing, open `public/index.html` in a browser. Alternatively, use the development server:

```powershell
npm start
```

Then visit `http://localhost:8080`.

## Privacy and safety

- The GitHub Pages edition performs file analysis locally in the browser.
- Files remain in that browser tab unless the visitor deliberately publishes them elsewhere.
- PDF filename, size and signature checks run before text analysis. Image-only PDFs should be exported to text/Markdown first.
- The static edition has no secrets, database, login, telemetry, or server endpoint.

## Optional Cloud Run edition

The repository retains the secure server and Google Cloud integrations for teams that later need Vertex AI or Document AI. They are **not required** for the public GitHub Pages version or the competition link.

# Resume Rebuilder

Resume Rebuilder is a private, local Next.js app that tailors a DOCX résumé to a job description, checks ATS keyword coverage, preserves the original document layout, and exports a PDF.

## Windows setup

Install these first:

- [Node.js 20.9 or newer](https://nodejs.org/)
- [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/) for DOCX-to-PDF export
- Git, if you are cloning from GitHub

Open PowerShell in the project folder and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\setup-windows.ps1
```

Open `.env.local`, replace the placeholder `GEMINI_API_KEY`, then start the app:

```powershell
.\scripts\start-windows.ps1
```

Open [http://localhost:3000](http://localhost:3000). The app stores the selected base résumé locally in `.base-resume/`; generated application data and ATS caches also remain on your PC and are excluded from Git.

LibreOffice is detected automatically from its standard Windows install folder or from `PATH`. For a custom installation, set its executable path in `.env.local`:

```dotenv
LIBREOFFICE_PATH=C:\Program Files\LibreOffice\program\soffice.exe
```

## Manual setup

The app also runs on macOS and Linux:

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `AI_PROVIDER=gemini` with `GEMINI_API_KEY`, or set `AI_PROVIDER=anthropic` with `ANTHROPIC_API_KEY`. Keep `.env.local` private because it contains credentials.

## Checks and production mode

```bash
npm run lint
npm run build
npm start
```

Production mode serves the app at [http://localhost:3000](http://localhost:3000) after a successful build.

## Private Railway deployment

The included `Dockerfile` installs LibreOffice for PDF export. Production also
requires a shared password; the Gemini key remains server-side and is never
sent to the browser.

1. Push this project to a private GitHub repository.
2. In Railway, create a project with **Deploy from GitHub repo** and select it.
3. Add these service variables:

   ```dotenv
   AI_PROVIDER=gemini
   GEMINI_API_KEY=your-real-key
   APP_PASSWORD=a-long-random-password-to-share-with-your-friend
   DATA_DIR=/data
   AI_TIMEOUT_MS=180000
   ```

4. Seal `GEMINI_API_KEY` in Railway after saving it.
5. Add a persistent volume mounted at `/data`. This keeps the saved base
   resume and ATS cache across deployments.
6. In **Settings > Networking**, generate a public domain.

Do not commit `.env.local` or paste the Gemini key into the Dockerfile. The
production app fails closed when `APP_PASSWORD` is missing. Login attempts are
limited per client, and uploaded resumes are limited to 10 MB.

This deployment has one shared base-resume slot. Uploading a new base resume
replaces the previous one for everyone using the deployment.

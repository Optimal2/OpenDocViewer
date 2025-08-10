# OpenDocViewer

OpenDocViewer is an open‑source, MIT‑licensed document viewer built with **React + Vite**.  
It supports images (JPG/PNG/TIFF) and PDFs, offers zoom/rotation/brightness/contrast, and can show documents side‑by‑side with thumbnails and printing.

## Table of Contents
- [Getting Started](#getting-started)
- [Available Scripts](#available-scripts)
- [Configuration](#configuration)
- [Logging](#logging)
- [Documentation](#documentation)
- [Features](#features)
- [License](#license)

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+ recommended)
- npm (comes with Node)

### Installation
```sh
git clone https://github.com/Optimal2/OpenDocViewer.git
cd OpenDocViewer
npm install
````

### Run (development)

```sh
npm run dev
```

Open the URL Vite prints (default: [http://localhost:5173](http://localhost:5173)).

### Build (production)

```sh
npm run build
```

Preview the production build:

```sh
npm run preview
```

## Available Scripts

* `npm run dev` — start Vite dev server with HMR.
* `npm run build` — build to `dist/`.
* `npm run preview` — preview the production build locally.
* `npm run start:log-server` — start the logging backend (`server.js`).
* `npm run dev:both` — run Vite dev server **and** the log server together.
* `npm run lint` / `npm run lint:fix` — ESLint checks / auto‑fixes.
* `npm run format` — format with Prettier.
* `npm run doc` — generate JSDoc to `docs/`.

> If `dev:both` isn’t in your `package.json` yet, add:
>
> ```json
> "start:log-server": "node server.js",
> "dev:both": "concurrently \"npm run dev\" \"npm run start:log-server\""
> ```

## Configuration

Common settings (log level, endpoints, etc.) live in `src/LogController.js`.
Public assets (e.g., `placeholder.png`, `lost.png`) are served from `/public`.

**PDF rendering:** the project uses `pdfjs-dist` with the worker URL resolved at build time to ensure the **API and worker versions match**.

## Logging

A tiny Express server receives log events.

* Start only the backend:

  ```sh
  npm run start:log-server
  ```
* Or start both UI + backend:

  ```sh
  npm run dev:both
  ```

Logs are written to `logs/` (and ignored by git).

## Documentation

Generate API docs with JSDoc:

```sh
npm run doc
```

Output goes to `docs/`.

## Features

* **Document viewing:** PDFs, JPG, PNG, TIFF.
* **Zoom & pan**
* **Rotate, brightness, contrast**
* **Comparison mode (side‑by‑side)**
* **Thumbnails + quick navigation**
* **Printing**
* **Structured logging (frontend → backend)**

## License

MIT — see `LICENSE`.

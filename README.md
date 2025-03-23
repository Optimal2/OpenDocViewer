# OpenDocViewer

OpenDocViewer is an open-source, MIT-licensed document viewer built with React. It supports multiple document formats, including images and PDFs, and provides intuitive features like zoom, rotation, brightness/contrast adjustments, and side-by-side document comparison.

## Table of Contents
- [Getting Started](#getting-started)
- [Available Scripts](#available-scripts)
- [Configuration](#configuration)
- [Logging](#logging)
- [Documentation](#documentation)
- [Features](#features)
- [Contributing](#contributing)
- [License](#license)

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v14.x or higher)
- [npm](https://www.npmjs.com/) (v6.x or higher)

### Installation
Clone the repository:
```sh
git clone https://github.com/Optimal2/OpenDocViewer/OpenDocViewer.git
```

Navigate to the project directory:
```sh
cd OpenDocViewer
```

Install dependencies:
```sh
npm install
```

### Running the App
Start the development server:
```sh
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser. The page reloads automatically upon changes, and any lint errors will appear in the console.

## Available Scripts

In the project directory, you can use:

### `npm start`
Runs the application in development mode.

### `npm test`
Runs tests in watch mode. See [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more details.

### `npm run build`
Creates a production-ready build in the `build` directory, optimized for performance.

### `npm run eject`
**Caution:** This action is irreversible. It moves all configurations (webpack, Babel, ESLint, etc.) directly into your project for manual control.

### `npm run lint`
Checks code for linting issues using ESLint.

### `npm run lint:fix`
Automatically fixes linting errors.

### `npm run format`
Formats code consistently with Prettier.

### `npm run start:log-server`
Starts the logging backend.

### `npm run start:both`
Starts both the React app and logging backend concurrently.

### `npm run doc`
Generates documentation using JSDoc in the `docs` directory.

## Configuration

Adjust application settings directly within the code. Common configurations include log levels and backend URLs, set in the `LogController.js` file.

## Logging

OpenDocViewer integrates a custom logging solution. Configure logging levels and backend URLs in `LogController.js`.

Start the logging backend separately:
```sh
npm run start:log-server
```

Start the app and logging backend together:
```sh
npm run start:both
```

## Documentation

Generate project documentation with JSDoc:
```sh
npm run doc
```
Documentation outputs to the `docs` folder.

## Features
- **Document Viewing:** Supports PDFs and images.
- **Zoom & Pan:** Smoothly navigate documents.
- **Adjustments:** Easily rotate, adjust brightness, and contrast.
- **Comparison Mode:** View documents side-by-side.
- **Thumbnails:** Quick navigation via thumbnails.
- **Printing:** Print documents directly.
- **Logging:** Tracks application events and errors effectively.

## Contributing

Contributions are welcome! Please open issues or submit pull requests.

## License

Distributed under the MIT License. See `LICENSE` for details.

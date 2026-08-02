import JSZip from 'jszip';
import { ExtractedFile, AndroidMetadata, ProjectMetadata } from '../types';

const TEXT_EXTENSIONS = new Set([
  'java', 'kt', 'kts', 'xml', 'gradle', 'json', 'properties', 'txt', 'md',
  'gitignore', 'pro', 'bat', 'sh', 'c', 'cpp', 'h', 'hpp', 'rs', 'py',
  'yaml', 'yml', 'html', 'css', 'js', 'ts', 'svg', 'cfg', 'conf', 'ini', 'toml'
]);

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'ico', 'jar', 'aar', 'apk', 'so',
  'zip', 'pdf', 'ttf', 'otf', 'keystore', 'jks', 'bin', 'class', 'db'
]);

// Helper to determine if file is text or binary
function isBinaryFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  if (TEXT_EXTENSIONS.has(ext)) return false;
  if (BINARY_EXTENSIONS.has(ext)) return true;
  return false;
}

// Convert ArrayBuffer to Base64 for binary files
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export async function parseZipFile(file: File): Promise<{
  files: ExtractedFile[];
  metadata: AndroidMetadata;
}> {
  const zip = new JSZip();
  const loadedZip = await zip.loadAsync(file);

  const filePaths = Object.keys(loadedZip.files).filter(
    (path) => !loadedZip.files[path].dir
  );

  // Check if all files share a single common top directory (e.g. MyProject-master/app/...)
  let rootPrefix = '';
  if (filePaths.length > 0) {
    const firstParts = filePaths[0].split('/');
    if (firstParts.length > 1) {
      const candidate = firstParts[0] + '/';
      if (filePaths.every((p) => p.startsWith(candidate))) {
        rootPrefix = candidate;
      }
    }
  }

  const extractedFiles: ExtractedFile[] = [];

  for (const originalPath of filePaths) {
    const zipObj = loadedZip.files[originalPath];
    if (zipObj.dir) continue;

    // Clean path by stripping common top-level wrapper if exists
    let cleanPath = originalPath;
    if (rootPrefix && cleanPath.startsWith(rootPrefix)) {
      cleanPath = cleanPath.substring(rootPrefix.length);
    }

    // Ignore unwanted cache/build outputs if any
    if (
      cleanPath.startsWith('.git/') ||
      cleanPath.includes('/build/') ||
      cleanPath.startsWith('.gradle/') ||
      cleanPath.startsWith('.idea/') ||
      cleanPath.endsWith('.apk')
    ) {
      // We can still include them or mark them, but by default we strip useless build artifacts
    }

    const name = cleanPath.split('/').pop() || cleanPath;
    const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';
    const binary = isBinaryFile(cleanPath);

    let content = '';
    let lineCount = 0;
    let binaryData: Uint8Array | undefined;

    const arrayBuffer = await zipObj.async('arraybuffer');
    const size = arrayBuffer.byteLength;

    if (binary) {
      content = arrayBufferToBase64(arrayBuffer);
      binaryData = new Uint8Array(arrayBuffer);
    } else {
      const decoder = new TextDecoder('utf-8', { fatal: false });
      content = decoder.decode(arrayBuffer);
      lineCount = content.split(/\r\n|\r|\n/).length;
    }

    extractedFiles.push({
      id: Math.random().toString(36).substring(2, 9),
      path: cleanPath,
      originalPath,
      name,
      ext,
      isBinary: binary,
      content,
      binaryData,
      size,
      lineCount,
      isSelected: true
    });
  }

  // Determine if this is an Android or Website project
  const isAndroid = extractedFiles.some(
    (f) =>
      f.name === 'AndroidManifest.xml' ||
      f.ext === 'kt' ||
      f.ext === 'gradle' ||
      f.ext === 'kts' ||
      f.path.includes('app/src/main/')
  );

  if (isAndroid) {
    const hasWorkflow = extractedFiles.some(
      (f) => f.path.includes('.github/workflows/') && f.path.endsWith('.yml')
    );
    if (!hasWorkflow) {
      extractedFiles.push(getAndroidWorkflowFile());
    }
  }

  const projectName = file.name.replace(/\.zip$/i, '');
  const metadata = analyzeProject(extractedFiles, projectName);

  return { files: extractedFiles, metadata };
}

export async function parseWebFiles(rawFiles: FileList | File[]): Promise<{
  files: ExtractedFile[];
  metadata: ProjectMetadata;
}> {
  const fileArray = Array.from(rawFiles);
  const extractedFiles: ExtractedFile[] = [];

  for (const f of fileArray) {
    const cleanPath = f.webkitRelativePath || f.name;
    const name = cleanPath.split('/').pop() || cleanPath;
    const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';
    const binary = isBinaryFile(cleanPath);

    let content = '';
    let lineCount = 0;
    const arrayBuffer = await f.arrayBuffer();
    const size = arrayBuffer.byteLength;

    if (binary) {
      content = arrayBufferToBase64(arrayBuffer);
    } else {
      const decoder = new TextDecoder('utf-8', { fatal: false });
      content = decoder.decode(arrayBuffer);
      lineCount = content.split(/\r\n|\r|\n/).length;
    }

    extractedFiles.push({
      id: Math.random().toString(36).substring(2, 9),
      path: cleanPath,
      originalPath: cleanPath,
      name,
      ext,
      isBinary: binary,
      content,
      size,
      lineCount,
      isSelected: true
    });
  }

  const firstFileName = fileArray[0]?.name.split('.')[0] || 'MyWebsite';
  const metadata = analyzeProject(extractedFiles, firstFileName);

  return { files: extractedFiles, metadata };
}

export function analyzeProject(files: ExtractedFile[], fallbackName: string): ProjectMetadata {
  let packageName: string | undefined;
  let minSdkVersion: string | undefined;
  let targetSdkVersion: string | undefined;
  let kotlinVersion: string | undefined;
  let gradleVersion: string | undefined;
  let hasManifest = false;
  let hasGradle = false;

  let ktJavaCount = 0;
  let xmlCount = 0;
  let gradleCount = 0;

  let htmlCount = 0;
  let cssCount = 0;
  let jsCount = 0;
  let webAssetCount = 0;
  let hasIndexHtml = false;
  let frameworkName = 'Static Web Page';

  let totalLines = 0;
  let totalSize = 0;

  let isAndroid = false;

  for (const file of files) {
    totalSize += file.size;
    if (file.lineCount) totalLines += file.lineCount;

    // Check Android
    if (file.ext === 'kt' || file.ext === 'java') {
      ktJavaCount++;
      isAndroid = true;
    }
    if (file.ext === 'gradle' || file.ext === 'kts') {
      gradleCount++;
      isAndroid = true;
    }
    if (file.name === 'AndroidManifest.xml') {
      hasManifest = true;
      isAndroid = true;
      const packageMatch = file.content.match(/package\s*=\s*["']([^"']+)["']/);
      if (packageMatch) packageName = packageMatch[1];
    }
    if (file.ext === 'xml') xmlCount++;

    if (file.name.includes('build.gradle') || file.name.includes('build.gradle.kts')) {
      hasGradle = true;
      isAndroid = true;
      if (!packageName) {
        const appIdMatch = file.content.match(/applicationId\s*=?\s*["']([^"']+)["']/);
        const nsMatch = file.content.match(/namespace\s*=?\s*["']([^"']+)["']/);
        if (nsMatch) packageName = nsMatch[1];
        else if (appIdMatch) packageName = appIdMatch[1];
      }

      const minSdkMatch = file.content.match(/minSdk\w*\s*=?\s*([0-9]+)/);
      if (minSdkMatch) minSdkVersion = minSdkMatch[1];

      const targetSdkMatch = file.content.match(/targetSdk\w*\s*=?\s*([0-9]+)/);
      if (targetSdkMatch) targetSdkVersion = targetSdkMatch[1];
    }

    // Check Website
    if (file.ext === 'html' || file.ext === 'htm') {
      htmlCount++;
      if (file.name.toLowerCase() === 'index.html') hasIndexHtml = true;
    }
    if (file.ext === 'css' || file.ext === 'scss' || file.ext === 'less') cssCount++;
    if (file.ext === 'js' || file.ext === 'ts' || file.ext === 'jsx' || file.ext === 'tsx') jsCount++;
    if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'ico'].includes(file.ext)) webAssetCount++;

    if (file.name === 'package.json') {
      if (file.content.includes('"react"')) frameworkName = 'React Web App';
      else if (file.content.includes('"vue"')) frameworkName = 'Vue Web App';
      else if (file.content.includes('"next"')) frameworkName = 'Next.js App';
      else if (file.content.includes('"vite"')) frameworkName = 'Vite Web App';
      else frameworkName = 'Node.js Web App';
    } else if (file.name.endsWith('.php')) {
      frameworkName = 'PHP Web Application';
    }
  }

  const projectType: 'android' | 'website' = isAndroid ? 'android' : 'website';

  return {
    projectType,
    projectName: fallbackName,
    packageName,
    minSdkVersion,
    targetSdkVersion,
    kotlinVersion,
    gradleVersion,
    hasManifest,
    hasGradle,
    ktJavaCount,
    xmlCount,
    gradleCount,
    htmlCount,
    cssCount,
    jsCount,
    webAssetCount,
    hasIndexHtml,
    frameworkName: isAndroid ? 'Android SDK (Gradle/Kotlin)' : frameworkName,
    totalFiles: files.length,
    totalLines,
    totalSize
  };
}

export function getAndroidWorkflowFile(): ExtractedFile {
  const content = `name: Build Android APK

on:
  push:
  pull_request:
  workflow_dispatch:

jobs:
  build:
    name: Build Android Debug APK
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Setup Gradle
        uses: gradle/actions/setup-gradle@v3

      - name: Make gradlew executable
        run: |
          if [ -f "./gradlew" ]; then
            chmod +x ./gradlew
          fi

      - name: Build APK with Gradle
        run: |
          if [ -f "./gradlew" ]; then
            ./gradlew assembleDebug --no-daemon || ./gradlew build --no-daemon
          else
            gradle assembleDebug --no-daemon || gradle build --no-daemon
          fi

      - name: Upload Built APK Artifact
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: app-debug-apk
          path: |
            **/build/outputs/apk/**/*.apk
            **/build/outputs/bundle/**/*.aab
          retention-days: 14
`;

  return {
    id: 'gh-workflow-android',
    path: '.github/workflows/android.yml',
    originalPath: '.github/workflows/android.yml',
    name: 'android.yml',
    ext: 'yml',
    isBinary: false,
    content: content,
    size: content.length,
    lineCount: content.split('\n').length,
    isSelected: true
  };
}

export function getWebsiteWorkflowFile(): ExtractedFile {
  const content = `name: Deploy Website to GitHub Pages

on:
  push:
    branches: ["main", "master"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  deploy:
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Pages
        uses: actions/configure-pages@v5

      - name: Upload Artifacts
        uses: actions/upload-pages-artifact@v3
        with:
          path: '.'

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
`;

  return {
    id: 'gh-workflow-website',
    path: '.github/workflows/static.yml',
    originalPath: '.github/workflows/static.yml',
    name: 'static.yml',
    ext: 'yml',
    isBinary: false,
    content: content,
    size: content.length,
    lineCount: content.split('\n').length,
    isSelected: true
  };
}

// Generate sample Android Hello World files for Instant Demo
export function createDemoAndroidProject(): { files: ExtractedFile[]; metadata: AndroidMetadata } {
  const files: ExtractedFile[] = [
    getAndroidWorkflowFile(),
    {
      id: 'd1',
      path: 'app/src/main/AndroidManifest.xml',
      originalPath: 'app/src/main/AndroidManifest.xml',
      name: 'AndroidManifest.xml',
      ext: 'xml',
      isBinary: false,
      content: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.example.androidapp">

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="My Android App"
        android:theme="@style/Theme.AppCompat.Light">
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>`,
      size: 680,
      lineCount: 19,
      isSelected: true
    },
    {
      id: 'd2',
      path: 'app/src/main/java/com/example/androidapp/MainActivity.kt',
      originalPath: 'app/src/main/java/com/example/androidapp/MainActivity.kt',
      name: 'MainActivity.kt',
      ext: 'kt',
      isBinary: false,
      content: `package com.example.androidapp

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import android.widget.TextView

class MainActivity : AppCompatActivity() {
    override function onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val textView = findViewById<TextView>(R.id.welcomeText)
        textView.text = "Hello GitHub! Android Upload Successful."
    }
}`,
      size: 450,
      lineCount: 16,
      isSelected: true
    },
    {
      id: 'd3',
      path: 'app/src/main/res/layout/activity_main.xml',
      originalPath: 'app/src/main/res/layout/activity_main.xml',
      name: 'activity_main.xml',
      ext: 'xml',
      isBinary: false,
      content: `<?xml version="1.0" encoding="utf-8"?>
<RelativeLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:padding="16dp">

    <TextView
        android:id="@+id/welcomeText"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Welcome to Android GitHub Uploader"
        android:textSize="20sp"
        android:layout_centerInParent="true" />

</RelativeLayout>`,
      size: 480,
      lineCount: 15,
      isSelected: true
    },
    {
      id: 'd4',
      path: 'app/build.gradle.kts',
      originalPath: 'app/build.gradle.kts',
      name: 'build.gradle.kts',
      ext: 'kts',
      isBinary: false,
      content: `plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.example.androidapp"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.androidapp"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }
}`,
      size: 320,
      lineCount: 18,
      isSelected: true
    },
    {
      id: 'd5',
      path: '.gitignore',
      originalPath: '.gitignore',
      name: '.gitignore',
      ext: 'gitignore',
      isBinary: false,
      content: `*.iml
.gradle
/local.properties
/.idea/
.DS_Store
/build
/captures
.externalNativeBuild
.cxx
local.properties`,
      size: 110,
      lineCount: 11,
      isSelected: true
    },
    {
      id: 'd6',
      path: 'README.md',
      originalPath: 'README.md',
      name: 'README.md',
      ext: 'md',
      isBinary: false,
      content: `# Android App Project

This Android project was extracted and uploaded using **GitHub Android Code Uploader**.

## Structure
- \`app/src/main/java/\`: Source code (Kotlin/Java)
- \`app/src/main/res/\`: Layouts and resources
- \`build.gradle.kts\`: Build configurations
`,
      size: 260,
      lineCount: 10,
      isSelected: true
    }
  ];

  const metadata = analyzeProject(files, 'DemoAndroidApp');
  return { files, metadata };
}

// Generate sample Website Project files for Instant Demo
export function createDemoWebsiteProject(): { files: ExtractedFile[]; metadata: ProjectMetadata } {
  const files: ExtractedFile[] = [
    {
      id: 'web1',
      path: 'index.html',
      originalPath: 'index.html',
      name: 'index.html',
      ext: 'html',
      isBinary: false,
      content: `<!DOCTYPE html>
<html lang="ur" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>خوش آمدید - ڈیمو ویب سائٹ پیج</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <div className="container">
    <header>
      <h1>🌐 میری ویب سائٹ (My Website Page)</h1>
      <p>GitHub Uploader کے ذریعے کامیابی سے اپلوڈ کی گئی ویب سائٹ پیج فائلیں۔</p>
    </header>

    <main>
      <section className="card">
        <h2>🚀 فیچرز</h2>
        <ul>
          <li>HTML5, CSS3, JavaScript سپورٹ</li>
          <li>GitHub Pages پر براہ راست لائیو ڈیپلائمنٹ</li>
          <li>فاسٹ اور محفوظ 1-Click اپلوڈ</li>
        </ul>
        <button id="clickBtn">کلک کریں (Click Me)</button>
      </section>
    </main>
  </div>

  <script src="js/script.js"></script>
</body>
</html>`,
      size: 850,
      lineCount: 30,
      isSelected: true
    },
    {
      id: 'web2',
      path: 'css/style.css',
      originalPath: 'css/style.css',
      name: 'style.css',
      ext: 'css',
      isBinary: false,
      content: `/* Modern Responsive CSS Stylesheet */
:root {
  --primary: #10b981;
  --bg-dark: #0f172a;
  --card-bg: #1e293b;
  --text: #f8fafc;
}

body {
  margin: 0;
  padding: 0;
  font-family: system-ui, -apple-system, sans-serif;
  background-color: var(--bg-dark);
  color: var(--text);
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
}

.container {
  width: 90%;
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem;
  background: var(--card-bg);
  border-radius: 16px;
  box-shadow: 0 10px 25px rgba(0,0,0,0.5);
}

button {
  background: var(--primary);
  color: white;
  border: none;
  padding: 12px 24px;
  font-size: 1rem;
  border-radius: 8px;
  cursor: pointer;
  transition: transform 0.2s, background 0.2s;
}

button:hover {
  transform: translateY(-2px);
  background: #059669;
}`,
      size: 780,
      lineCount: 42,
      isSelected: true
    },
    {
      id: 'web3',
      path: 'js/script.js',
      originalPath: 'js/script.js',
      name: 'script.js',
      ext: 'js',
      isBinary: false,
      content: `// Interactive Web Page Script
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('clickBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      alert('مبارک ہو! ویب سائٹ پیج کا سکرپٹ کامیابی سے چل رہا ہے۔');
    });
  }
});`,
      size: 280,
      lineCount: 11,
      isSelected: true
    },
    {
      id: 'web4',
      path: 'package.json',
      originalPath: 'package.json',
      name: 'package.json',
      ext: 'json',
      isBinary: false,
      content: `{
  "name": "my-demo-website",
  "version": "1.0.0",
  "description": "Responsive Web Page Project uploaded via GitHub Uploader",
  "main": "index.html",
  "scripts": {
    "start": "npx serve ."
  },
  "keywords": ["website", "html", "css", "js", "github-pages"]
}`,
      size: 260,
      lineCount: 11,
      isSelected: true
    },
    {
      id: 'web5',
      path: 'README.md',
      originalPath: 'README.md',
      name: 'README.md',
      ext: 'md',
      isBinary: false,
      content: `# 🌐 Demo Website Page

This website source repository was created and uploaded using **GitHub Direct Code Uploader**.

## Files
- \`index.html\`: Main HTML page structure
- \`css/style.css\`: Styling and layout
- \`js/script.js\`: Client-side JavaScript interactions

## GitHub Pages Setup
To publish this website live on GitHub Pages:
1. Go to repository **Settings** -> **Pages**.
2. Under **Build and deployment**, select \`main\` branch and root \`/\` directory.
3. Click **Save** to make your page live!
`,
      size: 450,
      lineCount: 15,
      isSelected: true
    }
  ];

  const metadata = analyzeProject(files, 'DemoWebsitePage');
  return { files, metadata };
}

export async function exportFilesToZip(files: ExtractedFile[], zipName: string = 'exported-project'): Promise<void> {
  const zip = new JSZip();

  for (const f of files) {
    if (f.isSelected === false) continue;
    if (f.isBinary) {
      try {
        const binaryString = window.atob(f.content);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        zip.file(f.path, bytes);
      } catch (e) {
        zip.file(f.path, f.content);
      }
    } else {
      zip.file(f.path, f.content);
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = zipName.toLowerCase().endsWith('.zip') ? zipName : `${zipName}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


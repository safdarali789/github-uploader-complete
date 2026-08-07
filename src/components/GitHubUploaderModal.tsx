import React, { useState, useEffect } from 'react';
import { ExtractedFile, GitHubUser, GitHubRepo, UploadState } from '../types';
import {
  getGitHubUser,
  getGitHubRepos,
  createGitHubRepo,
  uploadProjectToGitHub
} from '../utils/github';
import { getAndroidWorkflowFile, getWebsiteWorkflowFile, patchFilesForGitHubPages } from '../utils/zip';
import {
  Github,
  Key,
  FolderPlus,
  GitBranch,
  Send,
  AlertCircle,
  ExternalLink,
  Lock,
  Globe,
  Sparkles,
  X,
  CheckCircle2,
  RefreshCw,
  Info,
  Cpu,
  Smartphone,
  ShieldCheck
} from 'lucide-react';

interface GitHubUploaderModalProps {
  isOpen: boolean;
  onClose: () => void;
  files: ExtractedFile[];
  projectName: string;
  projectType?: 'android' | 'website';
  language: 'ur' | 'en';
}

export const GitHubUploaderModal: React.FC<GitHubUploaderModalProps> = ({
  isOpen,
  onClose,
  files,
  projectName,
  projectType = 'android',
  language
}) => {
  if (!isOpen) return null;

  const isUrdu = language === 'ur';

  // Detect project type automatically from files if needed
  const isAndroid = projectType === 'android' || files.some(f => f.ext === 'kt' || f.name === 'AndroidManifest.xml');

  // Auth & GitHub state
  const [token, setToken] = useState(() => localStorage.getItem('gh_uploader_pat') || '');
  const [saveToken, setSaveToken] = useState(true);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Repo Configuration
  const [selectedRepoMode, setSelectedRepoMode] = useState<'existing' | 'new'>('new');
  const [selectedRepo, setSelectedRepo] = useState<string>('');
  const [newRepoName, setNewRepoName] = useState(() =>
    projectName.toLowerCase().replace(/[^a-z0-9_-]/g, '-') || (isAndroid ? 'my-android-app' : 'my-website-page')
  );
  const [isPrivate, setIsPrivate] = useState(false);
  const [branch, setBranch] = useState('main');
  const [commitMessage, setCommitMessage] = useState(
    isAndroid
      ? 'Upload Android app source files via GitHub Direct Uploader'
      : 'Upload Website page source files via GitHub Direct Uploader'
  );
  const [autoWorkflow, setAutoWorkflow] = useState(true);

  // Upload Progress
  const [uploadState, setUploadState] = useState<UploadState>({
    status: 'idle',
    progress: 0
  });

  // Verify Token on Load
  useEffect(() => {
    if (token.trim().length >= 10) {
      verifyAndLoadUser(token);
    }
  }, []);

  const verifyAndLoadUser = async (pat: string) => {
    setIsAuthLoading(true);
    setAuthError(null);
    try {
      const userInfo = await getGitHubUser(pat);
      setUser(userInfo);
      if (saveToken) {
        localStorage.setItem('gh_uploader_pat', pat.trim());
      }
      // Load user repos
      const repoList = await getGitHubRepos(pat);
      setRepos(repoList);
      if (repoList.length > 0) {
        const defaultRepo = repoList[0];
        setSelectedRepo(defaultRepo.full_name || defaultRepo.name);
        if (defaultRepo.default_branch) {
          setBranch(defaultRepo.default_branch);
        }
      }
    } catch (err: any) {
      setUser(null);
      setAuthError(err.message || 'GitHub Authentication error');
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleVerifyToken = () => {
    if (!token.trim()) {
      setAuthError(
        isUrdu
          ? 'براہ کرم GitHub Personal Access Token درج کریں۔'
          : 'Please enter a GitHub Personal Access Token.'
      );
      return;
    }
    verifyAndLoadUser(token);
  };

  const handleClearToken = () => {
    setToken('');
    setUser(null);
    setRepos([]);
    localStorage.removeItem('gh_uploader_pat');
  };

  const handleStartUpload = async () => {
    if (!user) {
      setAuthError(isUrdu ? 'پہلے GitHub ٹوکن کی تصدیق کریں۔' : 'Please verify GitHub token first.');
      return;
    }

    let targetRepoName = selectedRepo;
    let targetRepoOwner = user.login;

    try {
      if (selectedRepoMode === 'new') {
        if (!newRepoName.trim()) {
          throw new Error(isUrdu ? 'ریپوزٹری کا نام خالی نہیں ہو سکتا۔' : 'Repository name cannot be empty.');
        }
        setUploadState({
          status: 'creating_repo',
          progress: 5,
          detailMessage: isUrdu ? 'نئی GitHub ریپوزٹری بنائی جا رہی ہے...' : 'Creating new GitHub repository...'
        });

        const createdRepo = await createGitHubRepo(token, newRepoName.trim(), isPrivate);
        targetRepoName = createdRepo.name;
        if (createdRepo.full_name && createdRepo.full_name.includes('/')) {
          targetRepoOwner = createdRepo.full_name.split('/')[0];
        }
      } else {
        const foundRepo = repos.find((r) => r.full_name === selectedRepo || r.name === selectedRepo);
        if (foundRepo) {
          targetRepoName = foundRepo.name;
          if (foundRepo.full_name && foundRepo.full_name.includes('/')) {
            targetRepoOwner = foundRepo.full_name.split('/')[0];
          }
        }
      }

      // Prepare files payload, including auto build / workflow if checked
      let filesToUpload = [...files];
      if (!isAndroid) {
        // ALWAYS auto-patch website files for Vercel and GitHub Pages compatibility to prevent white screen
        filesToUpload = patchFilesForGitHubPages(filesToUpload);
      } else if (autoWorkflow) {
        const hasWorkflow = filesToUpload.some(
          (f) => f.path.includes('.github/workflows/') && f.path.endsWith('.yml')
        );
        if (!hasWorkflow) {
          filesToUpload.push(getAndroidWorkflowFile());
        }
      }

      await uploadProjectToGitHub(
        token,
        targetRepoOwner,
        targetRepoName,
        branch,
        commitMessage,
        filesToUpload,
        (progressState) => setUploadState(progressState)
      );
    } catch (err: any) {
      setUploadState({
        status: 'error',
        progress: 0,
        error: err.message || 'Upload failed'
      });
    }
  };

  const selectedFilesCount = files.filter((f) => f.isSelected).length;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="p-4 sm:p-5 bg-slate-800 border-b border-slate-700 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3 rtl:space-x-reverse">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Github className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                {isUrdu ? 'GitHub پر ڈائریکٹ اپلوڈ کریں' : 'Push Directly to GitHub'}
              </h2>
              <p className="text-xs text-slate-400">
                {isUrdu
                  ? `${selectedFilesCount} فائلیں بذریعہ GitHub REST API اپلوڈ ہوں گی`
                  : `${selectedFilesCount} files ready for GitHub API commit`}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-700/60"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          
          {/* Step 1: Token Auth */}
          <div className="space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
            <label className="block text-xs font-bold text-slate-200 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-cyan-400" />
                1. GitHub Personal Access Token (PAT)
              </span>
              {user && (
                <button
                  type="button"
                  onClick={handleClearToken}
                  className="text-[11px] text-slate-400 hover:text-red-400 underline"
                >
                  {isUrdu ? 'ٹوکن تبدیل کریں' : 'Change Token'}
                </button>
              )}
            </label>

            {!user ? (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="ghp_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={handleVerifyToken}
                    disabled={isAuthLoading}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-colors shrink-0 flex items-center gap-1.5"
                  >
                    {isAuthLoading ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                    <span>{isUrdu ? 'تصدیق کریں' : 'Verify Token'}</span>
                  </button>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <label className="flex items-center space-x-1.5 rtl:space-x-reverse cursor-pointer">
                    <input
                      type="checkbox"
                      checked={saveToken}
                      onChange={(e) => setSaveToken(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-0"
                    />
                    <span>{isUrdu ? 'براؤزر میں ٹوکن محفوظ رکھیں' : 'Remember token in browser'}</span>
                  </label>

                  <a
                    href="https://github.com/settings/tokens/new?scopes=repo&description=GitHub+Android+Uploader"
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyan-400 hover:underline flex items-center gap-1"
                  >
                    <span>{isUrdu ? 'نیا PAT ٹوکن حاصل کریں' : 'Generate GitHub Token'}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-xl">
                <div className="flex items-center space-x-3 rtl:space-x-reverse">
                  <img
                    src={user.avatar_url}
                    alt={user.login}
                    className="w-8 h-8 rounded-full border border-emerald-500/40"
                  />
                  <div>
                    <h4 className="text-xs font-bold text-slate-100">{user.name || user.login}</h4>
                    <p className="text-[11px] text-emerald-400">@{user.login} (Authenticated)</p>
                  </div>
                </div>
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              </div>
            )}

            {authError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{authError}</span>
              </div>
            )}
          </div>

          {/* Step 2: Repository Selection & Options */}
          {user && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-200">
                  2. {isUrdu ? 'ریپوزٹری کا انتخاب (Repository)' : 'Target Repository'}
                </label>

                <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                  <button
                    type="button"
                    onClick={() => setSelectedRepoMode('new')}
                    className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                      selectedRepoMode === 'new'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {isUrdu ? 'نئی بنائیں (New)' : 'Create New'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedRepoMode('existing')}
                    className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                      selectedRepoMode === 'existing'
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {isUrdu ? 'موجودہ (Existing)' : 'Pick Existing'}
                  </button>
                </div>
              </div>

              {selectedRepoMode === 'new' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      {isUrdu ? 'ریپوزٹری کا نام' : 'Repo Name'}
                    </label>
                    <input
                      type="text"
                      value={newRepoName}
                      onChange={(e) => setNewRepoName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      {isUrdu ? 'سکورٹی (Privacy)' : 'Visibility'}
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsPrivate(!isPrivate)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 flex items-center justify-between"
                    >
                      <span className="flex items-center gap-1.5">
                        {isPrivate ? <Lock className="w-3.5 h-3.5 text-amber-400" /> : <Globe className="w-3.5 h-3.5 text-emerald-400" />}
                        {isPrivate ? (isUrdu ? 'پرائیویٹ (Private)' : 'Private') : (isUrdu ? 'پبلک (Public)' : 'Public')}
                      </span>
                      <span className="text-[10px] text-slate-500">{isUrdu ? 'تبدیل کرنے کے لیے کلک کریں' : 'Toggle'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    {isUrdu ? 'اپنی موجودہ ریپوزٹری منتخب کریں' : 'Select Existing Repo'}
                  </label>
                  <select
                    value={selectedRepo}
                    onChange={(e) => {
                      const repoVal = e.target.value;
                      setSelectedRepo(repoVal);
                      const found = repos.find((r) => r.full_name === repoVal || r.name === repoVal);
                      if (found && found.default_branch) {
                        setBranch(found.default_branch);
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                  >
                    {repos.map((r) => (
                      <option key={r.full_name || r.name} value={r.full_name || r.name}>
                        {r.full_name || r.name} {r.private ? '(Private)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Branch & Commit message */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1 flex items-center gap-1">
                    <GitBranch className="w-3 h-3 text-cyan-400" />
                    {isUrdu ? 'برانچ کا نام' : 'Branch'}
                  </label>
                  <input
                    type="text"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-[11px] text-slate-400 mb-1">
                    {isUrdu ? 'کمیٹ میسج (Commit Message)' : 'Commit Message'}
                  </label>
                  <input
                    type="text"
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200"
                  />
                </div>
              </div>

              {/* Auto Workflow GitHub Actions option */}
              <div className="p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-xl space-y-2">
                <div className="flex items-start space-x-3 rtl:space-x-reverse">
                  <input
                    type="checkbox"
                    id="autoWorkflow"
                    checked={autoWorkflow}
                    onChange={(e) => setAutoWorkflow(e.target.checked)}
                    className="mt-0.5 rounded border-emerald-600 bg-slate-900 text-emerald-500 focus:ring-0"
                  />
                  <label htmlFor="autoWorkflow" className="text-xs space-y-1 cursor-pointer">
                    <span className="font-bold text-emerald-300 flex items-center gap-1.5">
                      {isAndroid ? <Cpu className="w-3.5 h-3.5 text-cyan-400" /> : <Globe className="w-3.5 h-3.5 text-cyan-400" />}
                      {isAndroid
                        ? (isUrdu ? 'خودکار APK بلڈ شامل کریں (GitHub Actions CI/CD Workflow)' : 'Include Auto APK Build Workflow (.github/workflows/android.yml)')
                        : (isUrdu ? 'GitHub Pages لائیو ڈیپلائمنٹ ورک فلو شامل کریں (.github/workflows/static.yml)' : 'Include GitHub Pages Auto Deploy Workflow (.github/workflows/static.yml)')}
                    </span>
                    <p className="text-[11px] text-slate-300 leading-snug">
                      {isAndroid
                        ? (isUrdu
                            ? 'GitHub پر اپلوڈ ہوتے ہی GitHub Actions خودکار طور پر Gradle کے ذریعے APK بلڈ کرے گا، جسے آپ "Actions" ٹیب سے ڈاؤنلوڈ کر سکتے ہیں۔'
                            : 'Automatically compiles debug APK on GitHub servers on every commit! Downloadable under "Actions" tab.')
                        : (isUrdu
                            ? 'یہ سکرپٹ اپلوڈ ہوتے ہی GitHub Pages پر آپ کی ویب سائٹ کو خودکار طور پر لائیو پبلش کر دے گا۔'
                            : 'Automatically deploys your website to GitHub Pages so your page goes live instantly!')}
                    </p>
                  </label>
                </div>

                {autoWorkflow && user?.hasWorkflowScope === false && (
                  <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-[11px] text-amber-300 space-y-1 mt-2">
                    <p className="font-semibold flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                      {isUrdu ? 'اہم نوٹ: GitHub Token میں "workflow" کی اجازت لازمی ہے' : 'Important: PAT requires "workflow" scope'}
                    </p>
                    <p className="text-amber-200/90 leading-relaxed text-[10.5px]">
                      {isUrdu
                        ? 'اگر آپ کے GitHub PAT ٹوکن میں workflow scope نشان زد (check) نہیں ہے، تو GitHub اس فائل کو مسترد کر سکتا ہے۔ Token Settings میں جا کر "workflow" باکس کو ٹک کریں۔'
                        : 'If your Personal Access Token lacks the "workflow" scope, GitHub may block workflow files. Enable "workflow" scope in PAT settings.'}
                    </p>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* Progress / Upload Status */}
          {uploadState.status !== 'idle' && (
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
                <span className="flex items-center gap-2">
                  {uploadState.status === 'completed' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : uploadState.status === 'error' ? (
                    <AlertCircle className="w-4 h-4 text-red-400" />
                  ) : (
                    <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
                  )}
                  {uploadState.detailMessage || 'Uploading...'}
                </span>
                <span className="text-cyan-400">{uploadState.progress}%</span>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-gradient-to-r from-emerald-500 to-cyan-500 h-full transition-all duration-300"
                  style={{ width: `${uploadState.progress}%` }}
                />
              </div>

              {uploadState.error && (
                <p className="text-xs text-red-400 font-medium pt-1">
                  {uploadState.error}
                </p>
              )}

              {uploadState.repoUrl && (
                <div className="pt-2 space-y-3">
                  {!isAndroid && (
                    <div className="p-3.5 bg-slate-900 border border-cyan-500/40 rounded-xl space-y-2 text-left rtl:text-right">
                      <div className="flex items-center space-x-2 rtl:space-x-reverse text-cyan-300 text-xs font-bold">
                        <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
                        <span>{isUrdu ? 'لائیو لنک (Live Site Link) حاصل کرنے کا حتمی طریقہ:' : 'How to generate and view your Live Site Link:'}</span>
                      </div>
                      
                      <div className="space-y-2 text-[11px] text-slate-300 leading-relaxed">
                        <p className="font-semibold text-emerald-300">
                          {isUrdu 
                            ? 'طریقہ 1: GitHub Actions سے لائیو کریں (تمام پروجیکٹس کے لیے)'
                            : 'Method 1: Run GitHub Actions (Recommended for React / Vite)'}
                        </p>
                        <ol className="list-decimal list-inside space-y-1 pl-1 text-slate-300">
                          <li>{isUrdu ? 'اپنی Repository کھولیں اور اوپر **Actions** ٹیب پر کلک کریں۔' : 'Open your Repository and click the **Actions** tab at the top.'}</li>
                          <li>{isUrdu ? 'بائیں جانب **"Deploy Web App to GitHub Pages"** منتخب کریں۔' : 'Select **"Deploy Web App to GitHub Pages"** on the left.'}</li>
                          <li>{isUrdu ? '**Run workflow** بٹن پر کلک کریں -> پھر دوبارہ **Run workflow** دبائیں۔' : 'Click **Run workflow** button -> then click **Run workflow**.'}</li>
                          <li>{isUrdu ? '30 سیکنڈ بعد سبز نِشان (✅) آتے ہی **Settings -> Pages** میں لائیو لنک آ جائے گا!' : 'After ~30s, check **Settings -> Pages** or Actions summary for your Live URL!'}</li>
                        </ol>

                        <div className="pt-1 border-t border-slate-800">
                          <p className="font-semibold text-cyan-300">
                            {isUrdu 
                              ? 'طریقہ 2: "Deploy from a branch" (سادہ ویب سائٹ کے لیے فوری لائیو)'
                              : 'Method 2: "Deploy from a branch" (Instant live for static sites)'}
                          </p>
                          <p className="text-[10.5px] text-slate-400 mt-0.5">
                            {isUrdu
                              ? 'GitHub Settings -> Pages میں جائیں -> Source کو **"Deploy from a branch"** کریں -> Branch کو **main** اور Folder کو **/ (root)** رکھ کر **Save** کر دیں۔ 15 سیکنڈز میں لنک اوپر شو ہو جائے گا!'
                              : 'Go to Settings -> Pages -> Set Source to "Deploy from a branch" -> Select main branch and / (root) folder -> Click Save. URL appears in 15s!'}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <a
                      href={uploadState.repoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-lg shadow-emerald-500/20"
                    >
                      <span>{isUrdu ? 'GitHub پر ریپوزٹری کھولیں' : 'Open Repository on GitHub'}</span>
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-800/80 border-t border-slate-700 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl text-xs font-semibold"
          >
            {isUrdu ? 'منسوخ کریں' : 'Cancel'}
          </button>

          {user && uploadState.status !== 'completed' && (
            <button
              type="button"
              onClick={handleStartUpload}
              disabled={['creating_repo', 'uploading_blobs', 'creating_tree', 'committing'].includes(uploadState.status)}
              className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              <span>
                {isUrdu ? 'مکمل پروجیکٹ اپلوڈ کریں' : 'Start Full GitHub Upload'}
              </span>
            </button>
          )}
        </div>

      </div>
    </div>
  );
};

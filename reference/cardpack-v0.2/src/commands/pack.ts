import * as fs from 'fs';
import * as path from 'path';
import {
  createArchive,
  extractArchive,
  listArchive,
  addToArchive,
  removeFromArchive,
  rewriteArchive,
} from '../pack/index.js';
import { parseTransformArg, type TransformRuleSpec } from '../pack/transform-rules.js';
import { parseRewriteArgs, type RewriteRule } from '../pack/url-rewriter.js';
import { mergeArchive, type MergeStrategy, type ConflictMode } from '../pack/merge.js';

const FG_GREEN = '\x1b[32m';
const FG_CYAN = '\x1b[36m';
const FG_RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export interface PackCommandOptions {
  output?: string;
  target?: string;
  description?: string;
  root?: string;
  transform?: string[];
  rewriteUrls?: string[];
  onConflict?: string;
  dryRun?: boolean;
  from?: string;
  to?: string;
  into?: string;
  strategy?: string;
}

export async function packCommand(
  subcommand?: string,
  arg1?: string,
  arg2?: string,
  options?: PackCommandOptions,
): Promise<void> {
  switch (subcommand) {
    case 'create':
      await handleCreate(arg1, options);
      break;

    case 'extract':
      await handleExtract(arg1, options);
      break;

    case 'list':
    case 'ls':
      await handleList(arg1);
      break;

    case 'add':
      await handleAdd(arg1, arg2);
      break;

    case 'remove':
    case 'rm':
      await handleRemove(arg1, arg2);
      break;

    case 'rewrite':
      await handleRewrite(arg1, options);
      break;

    case 'merge':
      await handleMerge(arg1, options);
      break;

    default:
      printHelp();
  }
}

async function handleCreate(
  sourceDir?: string,
  options?: PackCommandOptions,
): Promise<void> {
  if (!sourceDir) {
    console.error(`${FG_RED}Error:${RESET} Source directory is required.`);
    console.log(`Usage: boxel pack create <directory> [--output name.cardpack]`);
    process.exit(1);
  }

  const resolvedDir = path.resolve(sourceDir);
  if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
    console.error(`${FG_RED}Error:${RESET} Not a directory: ${sourceDir}`);
    process.exit(1);
  }

  const defaultName = path.basename(resolvedDir) + '.cardpack';
  const outputPath = path.resolve(options?.output || defaultName);

  console.log(`${FG_CYAN}Packing:${RESET} ${resolvedDir}`);
  console.log(`${FG_CYAN}Output:${RESET}  ${outputPath}`);

  if (options?.root) {
    console.log(`${FG_CYAN}Root:${RESET}    ${options.root}`);
  }

  // Parse transform rules
  let transformRules: TransformRuleSpec[] | undefined;
  if (options?.transform && options.transform.length > 0) {
    try {
      transformRules = options.transform.map(parseTransformArg);
      for (const rule of transformRules) {
        console.log(`${FG_CYAN}Rule:${RESET}    ${rule.pattern} → ${rule.rule}${rule.transform ? ':' + rule.transform : ''}`);
      }
    } catch (error) {
      console.error(`${FG_RED}Error:${RESET} Invalid transform spec:`, (error as Error).message);
      process.exit(1);
    }
  }

  try {
    const manifest = await createArchive({
      sourceDir: resolvedDir,
      outputPath,
      description: options?.description,
      sourceRealm: detectSourceRealm(resolvedDir),
      createdBy: detectCreatedBy(),
      rootFile: options?.root,
      transformRules,
    });

    const count = manifest.attributes.entries.length;
    const totalSize = manifest.attributes.entries.reduce((sum, e) => sum + e.size, 0);
    const archiveSize = fs.statSync(outputPath).size;

    console.log(`\n${FG_GREEN}Created:${RESET} ${path.basename(outputPath)}`);
    console.log(`  ${DIM}Files:${RESET}    ${count}`);
    console.log(`  ${DIM}Original:${RESET} ${formatBytes(totalSize)}`);
    console.log(`  ${DIM}Packed:${RESET}   ${formatBytes(archiveSize)}`);

    // Show rule breakdown if transforms were applied
    if (transformRules) {
      const ruleCounts = { copy: 0, exclude: 0, reference: 0, export: 0 };
      for (const e of manifest.attributes.entries) {
        ruleCounts[e.rule || 'copy']++;
      }
      if (ruleCounts.exclude > 0) console.log(`  ${DIM}Excluded:${RESET} ${ruleCounts.exclude}`);
      if (ruleCounts.reference > 0) console.log(`  ${DIM}Refs:${RESET}     ${ruleCounts.reference}`);
      if (ruleCounts.export > 0) console.log(`  ${DIM}Exported:${RESET} ${ruleCounts.export}`);
    }
  } catch (error) {
    console.error(`${FG_RED}Error:${RESET} Failed to create cardpack:`, error);
    process.exit(1);
  }
}

async function handleExtract(
  archivePath?: string,
  options?: PackCommandOptions,
): Promise<void> {
  if (!archivePath) {
    console.error(`${FG_RED}Error:${RESET} Archive path is required.`);
    console.log(`Usage: boxel pack extract <file.cardpack> [--target ./dir]`);
    process.exit(1);
  }

  const resolvedArchive = path.resolve(archivePath);
  if (!fs.existsSync(resolvedArchive)) {
    console.error(`${FG_RED}Error:${RESET} File not found: ${archivePath}`);
    process.exit(1);
  }

  const defaultTarget = path.basename(archivePath, '.cardpack');
  const targetDir = path.resolve(options?.target || defaultTarget);

  console.log(`${FG_CYAN}Extracting:${RESET} ${resolvedArchive}`);
  console.log(`${FG_CYAN}Target:${RESET}    ${targetDir}`);

  // Parse rewrite rules
  let rewriteRules: RewriteRule[] | undefined;
  if (options?.rewriteUrls && options.rewriteUrls.length > 0) {
    try {
      rewriteRules = parseRewriteArgs(options.rewriteUrls);
      for (const rule of rewriteRules) {
        console.log(`${FG_CYAN}Rewrite:${RESET}  ${rule.from} → ${rule.to}`);
      }
    } catch (error) {
      console.error(`${FG_RED}Error:${RESET} Invalid rewrite args:`, (error as Error).message);
      process.exit(1);
    }
  }

  const onConflict = options?.onConflict as 'overwrite' | 'skip' | undefined;
  if (onConflict && onConflict !== 'overwrite' && onConflict !== 'skip') {
    console.error(`${FG_RED}Error:${RESET} --on-conflict must be "overwrite" or "skip"`);
    process.exit(1);
  }

  if (options?.dryRun) {
    console.log(`${FG_CYAN}Mode:${RESET}     dry-run (no files written)`);
  }

  try {
    if (!fs.existsSync(targetDir) && !options?.dryRun) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const result = await extractArchive({
      archivePath: resolvedArchive,
      targetDir,
      validate: true,
      rewriteRules,
      onConflict,
      dryRun: options?.dryRun,
    });

    console.log(`\n${FG_GREEN}Extracted:${RESET} ${result.extracted.length} files to ${targetDir}`);
    if (result.skipped.length > 0) {
      console.log(`  ${DIM}Skipped:${RESET}  ${result.skipped.length} (conflicts)`);
    }
    if (result.conflicts.length > 0) {
      console.log(`  ${DIM}Overwrote:${RESET} ${result.conflicts.length} (conflicts)`);
    }
    if (result.rewriteCount > 0) {
      console.log(`  ${DIM}Rewrites:${RESET} ${result.rewriteCount} URL(s)`);
    }
  } catch (error) {
    console.error(`${FG_RED}Error:${RESET} Failed to extract cardpack:`, error);
    process.exit(1);
  }
}

async function handleList(archivePath?: string): Promise<void> {
  if (!archivePath) {
    console.error(`${FG_RED}Error:${RESET} Archive path is required.`);
    console.log(`Usage: boxel pack list <file.cardpack>`);
    process.exit(1);
  }

  const resolvedArchive = path.resolve(archivePath);
  if (!fs.existsSync(resolvedArchive)) {
    console.error(`${FG_RED}Error:${RESET} File not found: ${archivePath}`);
    process.exit(1);
  }

  try {
    const { manifest, entries } = await listArchive(resolvedArchive);

    console.log(`\n${BOLD}${path.basename(archivePath)}${RESET}`);
    console.log(`  ${DIM}Version:${RESET}   ${manifest.attributes.version}`);
    console.log(`  ${DIM}Created:${RESET}   ${manifest.attributes.createdAt}`);
    console.log(`  ${DIM}By:${RESET}        ${manifest.attributes.createdBy}`);
    console.log(`  ${DIM}Source:${RESET}    ${manifest.attributes.sourceRealm}`);
    if (manifest.attributes.description) {
      console.log(`  ${DIM}Desc:${RESET}      ${manifest.attributes.description}`);
    }
    console.log(`  ${DIM}Files:${RESET}     ${entries.length}`);

    console.log(`\n${BOLD}Contents:${RESET}`);
    const totalSize = entries.reduce((sum, e) => sum + e.size, 0);
    const hasNonCopyRules = entries.some((e) => e.rule && e.rule !== 'copy');

    for (const entry of entries) {
      const sizeStr = formatBytes(entry.size).padStart(8);
      let suffix = '';
      if (hasNonCopyRules) {
        const rule = entry.rule || 'copy';
        if (rule !== 'copy') {
          suffix = ` ${DIM}[${rule}`;
          if (rule === 'reference' && entry.referenceUrl) suffix += `: ${entry.referenceUrl}`;
          if (rule === 'export' && entry.transform) suffix += `: ${entry.transform}`;
          suffix += `]${RESET}`;
        }
      }
      console.log(`  ${sizeStr}  ${entry.path}${suffix}`);
    }

    console.log(`\n  ${DIM}Total: ${formatBytes(totalSize)}${RESET}`);
  } catch (error) {
    console.error(`${FG_RED}Error:${RESET} Failed to read cardpack:`, error);
    process.exit(1);
  }
}

async function handleAdd(
  archivePath?: string,
  filePath?: string,
): Promise<void> {
  if (!archivePath || !filePath) {
    console.error(`${FG_RED}Error:${RESET} Archive path and file path are required.`);
    console.log(`Usage: boxel pack add <file.cardpack> <file-to-add>`);
    process.exit(1);
  }

  const resolvedArchive = path.resolve(archivePath);
  const resolvedFile = path.resolve(filePath);

  if (!fs.existsSync(resolvedArchive)) {
    console.error(`${FG_RED}Error:${RESET} Archive not found: ${archivePath}`);
    process.exit(1);
  }
  if (!fs.existsSync(resolvedFile)) {
    console.error(`${FG_RED}Error:${RESET} File not found: ${filePath}`);
    process.exit(1);
  }

  try {
    const manifest = await addToArchive(resolvedArchive, resolvedFile);
    console.log(
      `${FG_GREEN}Added:${RESET} ${path.basename(filePath)} to ${path.basename(archivePath)}`,
    );
    console.log(`  ${DIM}Total files:${RESET} ${manifest.attributes.entries.length}`);
  } catch (error) {
    console.error(`${FG_RED}Error:${RESET} Failed to add file:`, error);
    process.exit(1);
  }
}

async function handleRemove(
  archivePath?: string,
  pathInside?: string,
): Promise<void> {
  if (!archivePath || !pathInside) {
    console.error(`${FG_RED}Error:${RESET} Archive path and internal path are required.`);
    console.log(`Usage: boxel pack remove <file.cardpack> <path/inside>`);
    process.exit(1);
  }

  const resolvedArchive = path.resolve(archivePath);
  if (!fs.existsSync(resolvedArchive)) {
    console.error(`${FG_RED}Error:${RESET} Archive not found: ${archivePath}`);
    process.exit(1);
  }

  try {
    const manifest = await removeFromArchive(resolvedArchive, pathInside);
    console.log(
      `${FG_GREEN}Removed:${RESET} ${pathInside} from ${path.basename(archivePath)}`,
    );
    console.log(`  ${DIM}Remaining files:${RESET} ${manifest.attributes.entries.length}`);
  } catch (error) {
    console.error(`${FG_RED}Error:${RESET} Failed to remove file:`, error);
    process.exit(1);
  }
}

async function handleRewrite(
  archivePath?: string,
  options?: PackCommandOptions,
): Promise<void> {
  if (!archivePath) {
    console.error(`${FG_RED}Error:${RESET} Archive path is required.`);
    console.log(`Usage: boxel pack rewrite <file.cardpack> --from <url> --to <url>`);
    process.exit(1);
  }

  if (!options?.from || !options?.to) {
    console.error(`${FG_RED}Error:${RESET} Both --from and --to are required.`);
    console.log(`Usage: boxel pack rewrite <file.cardpack> --from <url> --to <url>`);
    process.exit(1);
  }

  const resolvedArchive = path.resolve(archivePath);
  if (!fs.existsSync(resolvedArchive)) {
    console.error(`${FG_RED}Error:${RESET} File not found: ${archivePath}`);
    process.exit(1);
  }

  console.log(`${FG_CYAN}Rewriting:${RESET} ${resolvedArchive}`);
  console.log(`${FG_CYAN}From:${RESET}      ${options.from}`);
  console.log(`${FG_CYAN}To:${RESET}        ${options.to}`);

  try {
    const result = await rewriteArchive(resolvedArchive, [
      { from: options.from, to: options.to },
    ]);
    console.log(
      `\n${FG_GREEN}Rewritten:${RESET} ${result.rewriteCount} URL(s) in ${path.basename(archivePath)}`,
    );
  } catch (error) {
    console.error(`${FG_RED}Error:${RESET} Failed to rewrite archive:`, error);
    process.exit(1);
  }
}

async function handleMerge(
  archivePath?: string,
  options?: PackCommandOptions,
): Promise<void> {
  if (!archivePath) {
    console.error(`${FG_RED}Error:${RESET} Archive path is required.`);
    console.log(`Usage: boxel pack merge <file.cardpack> --into <dir> [--strategy full]`);
    process.exit(1);
  }

  if (!options?.into) {
    console.error(`${FG_RED}Error:${RESET} --into target directory is required.`);
    console.log(`Usage: boxel pack merge <file.cardpack> --into <dir>`);
    process.exit(1);
  }

  const resolvedArchive = path.resolve(archivePath);
  if (!fs.existsSync(resolvedArchive)) {
    console.error(`${FG_RED}Error:${RESET} File not found: ${archivePath}`);
    process.exit(1);
  }

  const targetDir = path.resolve(options.into);
  const strategy = (options.strategy || 'full') as MergeStrategy;
  const validStrategies: MergeStrategy[] = ['full', 'instance-only', 'definitions-only'];
  if (!validStrategies.includes(strategy)) {
    console.error(
      `${FG_RED}Error:${RESET} --strategy must be one of: ${validStrategies.join(', ')}`,
    );
    process.exit(1);
  }

  const onConflict = (options.onConflict || 'skip') as ConflictMode;
  if (onConflict !== 'overwrite' && onConflict !== 'skip') {
    console.error(`${FG_RED}Error:${RESET} --on-conflict must be "overwrite" or "skip"`);
    process.exit(1);
  }

  // Parse rewrite rules
  let rewriteRules: RewriteRule[] | undefined;
  if (options.rewriteUrls && options.rewriteUrls.length > 0) {
    try {
      rewriteRules = parseRewriteArgs(options.rewriteUrls);
    } catch (error) {
      console.error(`${FG_RED}Error:${RESET} Invalid rewrite args:`, (error as Error).message);
      process.exit(1);
    }
  }

  console.log(`${FG_CYAN}Merging:${RESET}   ${resolvedArchive}`);
  console.log(`${FG_CYAN}Into:${RESET}      ${targetDir}`);
  console.log(`${FG_CYAN}Strategy:${RESET}  ${strategy}`);
  console.log(`${FG_CYAN}Conflict:${RESET}  ${onConflict}`);
  if (options.dryRun) console.log(`${FG_CYAN}Mode:${RESET}      dry-run`);

  try {
    const result = await mergeArchive({
      archivePath: resolvedArchive,
      targetDir,
      strategy,
      onConflict,
      rewriteRules,
      dryRun: options.dryRun,
    });

    console.log(`\n${FG_GREEN}Merge complete:${RESET}`);
    if (result.created.length > 0) console.log(`  ${DIM}Created:${RESET}  ${result.created.length}`);
    if (result.updated.length > 0) console.log(`  ${DIM}Updated:${RESET}  ${result.updated.length}`);
    if (result.skipped.length > 0) console.log(`  ${DIM}Skipped:${RESET}  ${result.skipped.length}`);
  } catch (error) {
    console.error(`${FG_RED}Error:${RESET} Failed to merge:`, error);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`\n${BOLD}boxel pack${RESET} - Create and manage .cardpack archives\n`);
  console.log(`${BOLD}Commands:${RESET}`);
  console.log(
    `  ${FG_CYAN}create${RESET} <dir> [--output name.cardpack]    Pack directory into .cardpack`,
  );
  console.log(
    `         ${DIM}--root <file>${RESET}                     Only pack root card and its dependencies`,
  );
  console.log(
    `         ${DIM}--transform <spec...>${RESET}             Transform rules (glob:rule[:name])`,
  );
  console.log(
    `  ${FG_CYAN}extract${RESET} <file.cardpack> [--target dir]   Extract .cardpack to directory`,
  );
  console.log(
    `         ${DIM}--rewrite-urls <from> <to>${RESET}       Rewrite URLs during extraction`,
  );
  console.log(
    `         ${DIM}--on-conflict <mode>${RESET}             overwrite | skip`,
  );
  console.log(
    `         ${DIM}--dry-run${RESET}                        Preview without writing`,
  );
  console.log(
    `  ${FG_CYAN}list${RESET} <file.cardpack>                     List contents of .cardpack`,
  );
  console.log(
    `  ${FG_CYAN}add${RESET} <file.cardpack> <file>               Add file to .cardpack`,
  );
  console.log(
    `  ${FG_CYAN}remove${RESET} <file.cardpack> <path>            Remove file from .cardpack`,
  );
  console.log(
    `  ${FG_CYAN}rewrite${RESET} <file.cardpack> --from <url> --to <url>`,
  );
  console.log(
    `         ${DIM}Rewrite URLs in-place inside an archive${RESET}`,
  );
  console.log(
    `  ${FG_CYAN}merge${RESET} <file.cardpack> --into <dir>          Merge archive into directory`,
  );
  console.log(
    `         ${DIM}--strategy <type>${RESET}                full | instance-only | definitions-only`,
  );
  console.log(
    `         ${DIM}--on-conflict <mode>${RESET}             overwrite | skip`,
  );
  console.log(
    `         ${DIM}--rewrite-urls <from> <to>${RESET}       Rewrite URLs during merge`,
  );
  console.log(
    `         ${DIM}--dry-run${RESET}                        Preview without writing`,
  );
}

function detectSourceRealm(dir: string): string {
  try {
    const manifestPath = path.join(dir, '.boxel-sync.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      return manifest.workspaceUrl || dir;
    }
  } catch {
    /* ignore */
  }
  return dir;
}

function detectCreatedBy(): string {
  try {
    // Dynamic import would be async; use a synchronous check instead
    const profileConfigPath = path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      '.boxel-cli',
      'profiles.json',
    );
    if (fs.existsSync(profileConfigPath)) {
      const config = JSON.parse(fs.readFileSync(profileConfigPath, 'utf-8'));
      if (config.activeProfile) {
        return config.activeProfile;
      }
    }
  } catch {
    /* ignore */
  }
  return 'unknown';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

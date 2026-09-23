import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import swc from 'next/dist/build/swc/index.js';

// Compile the actual JSX components with Next's compiler, without a browser.
const require = createRequire(import.meta.url);
export async function componentUrl(url) {
  const { code } = await swc.transform(await readFile(url, 'utf8'), {
    filename: url.pathname,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'es6' },
  });
  let resolved = code;
  for (const match of code.matchAll(/from ["']([^"']+)["']/g)) {
    const specifier = match[1];
    let target;
    if (specifier.startsWith('.')) {
      const dependency = new URL(specifier, url);
      target = dependency.pathname.endsWith('.mjs') ? dependency.href : await componentUrl(new URL(`${specifier}.js`, url));
    } else target = pathToFileURL(require.resolve(specifier)).href;
    resolved = resolved.replace(match[0], `from ${JSON.stringify(target)}`);
  }
  return `data:text/javascript;base64,${Buffer.from(resolved).toString('base64')}`;
}

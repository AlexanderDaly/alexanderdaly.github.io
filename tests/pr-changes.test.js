/**
 * Tests for PR changes:
 *  - SECURITY.md (new file)
 *  - banana.svg (trailing newline removed)
 *  - .DS_Store (deleted)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function fileExists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

// ---------------------------------------------------------------------------
// .DS_Store — deleted
// ---------------------------------------------------------------------------

describe('.DS_Store deletion', () => {
  it('should not exist in the repository (binary macOS metadata file was removed)', () => {
    assert.equal(
      fileExists('.DS_Store'),
      false,
      '.DS_Store must not exist — it was deleted in this PR'
    );
  });
});

// ---------------------------------------------------------------------------
// SECURITY.md — new file
// ---------------------------------------------------------------------------

describe('SECURITY.md', () => {
  let content;

  // Runs before each test in this describe block; we read once and share.
  content = (() => {
    assert.ok(fileExists('SECURITY.md'), 'SECURITY.md must exist');
    return readFile('SECURITY.md');
  })();

  // --- File-level checks ---

  it('exists and is non-empty', () => {
    assert.ok(fileExists('SECURITY.md'));
    assert.ok(content.length > 0, 'SECURITY.md must not be empty');
  });

  it('starts with the H1 title "# Security Policy"', () => {
    assert.ok(
      content.startsWith('# Security Policy'),
      'First line must be "# Security Policy"'
    );
  });

  // --- Required H2 sections ---

  const requiredSections = [
    'Supported Versions',
    'Reporting a Vulnerability',
    'What to Include',
    'Scope',
    'Response Expectations',
    'Safe Harbor',
  ];

  for (const section of requiredSections) {
    it(`contains required H2 section: "${section}"`, () => {
      assert.ok(
        content.includes(`## ${section}`),
        `SECURITY.md must contain the H2 heading "## ${section}"`
      );
    });
  }

  // --- Supported Versions table ---

  it('lists "main" branch as supported in the versions table', () => {
    assert.match(content, /`main`\s*\/\s*current live site/);
    assert.ok(
      content.includes('✅ Supported'),
      'Table must mark main branch as supported'
    );
  });

  it('lists pull requests as reviewed before merge', () => {
    assert.ok(
      content.includes('Pull requests awaiting review'),
      'Table should mention pull requests'
    );
    assert.ok(
      content.includes('✅ Reviewed before merge'),
      'Pull requests should be marked as reviewed before merge'
    );
  });

  it('marks old commits, forks, and archived copies as not supported', () => {
    assert.ok(
      content.includes('Old commits, forks, or archived copies'),
      'Table must mention old commits/forks'
    );
    assert.ok(
      content.includes('❌ Not supported'),
      'Old commits/forks must be marked as not supported'
    );
  });

  // --- Vulnerability reporting instructions ---

  it('mentions GitHub private vulnerability reporting as the preferred path', () => {
    assert.match(
      content,
      /private vulnerability reporting/i,
      'Should reference GitHub private vulnerability reporting'
    );
  });

  it('instructs reporters NOT to include exploit details in public issues', () => {
    assert.match(
      content,
      /do \*\*not\*\* include exploit details/i,
      'Should warn against posting exploit details publicly'
    );
  });

  // --- What to Include section ---

  it('asks reporters to include steps to reproduce', () => {
    assert.match(
      content,
      /steps to reproduce/i,
      '"What to Include" must mention steps to reproduce'
    );
  });

  it('asks reporters to describe potential impact', () => {
    assert.match(
      content,
      /potential impact/i,
      '"What to Include" must mention potential impact'
    );
  });

  it('asks about exposure of private data or credentials', () => {
    assert.match(
      content,
      /secrets, credentials/i,
      'Should ask whether the issue exposes secrets or credentials'
    );
  });

  // --- Scope section ---

  const inScopeItems = [
    /cross-site scripting/i,
    /exposed secrets/i,
    /github pages deployment/i,
    /vulnerable dependencies/i,
    /misconfigurations/i,
  ];

  for (const pattern of inScopeItems) {
    it(`lists in-scope item matching: ${pattern}`, () => {
      assert.match(content, pattern);
    });
  }

  const outOfScopeItems = [
    /generic best-practice suggestions/i,
    /social engineering/i,
    /denial-of-service/i,
    /automated scanner output/i,
  ];

  for (const pattern of outOfScopeItems) {
    it(`lists out-of-scope item matching: ${pattern}`, () => {
      assert.match(content, pattern);
    });
  }

  // --- Response Expectations ---

  it('commits to acknowledging reports', () => {
    assert.match(content, /acknowledge/i);
  });

  it('mentions coordinating disclosure', () => {
    assert.match(content, /coordinate disclosure/i);
  });

  it('offers to credit reporters for valid reports', () => {
    assert.match(content, /credit the reporter/i);
  });

  // --- Safe Harbor ---

  it('welcomes good-faith security research', () => {
    assert.match(content, /good-faith security research/i);
  });

  it('asks researchers not to access data they do not own', () => {
    assert.match(content, /do not access.*data that is not yours/i);
  });

  it('asks researchers to only test authorized systems', () => {
    assert.match(
      content,
      /only test against systems you are authorized/i
    );
  });

  // --- Boundary / regression checks ---

  it('does not contain actual exploit payloads, secret values, or hardcoded credentials', () => {
    // The document should be a policy, not contain real attack vectors
    const suspiciousPatterns = [
      /<script>/i,
      /password\s*=\s*["'][^"']+["']/i,
      /api[_-]?key\s*[:=]\s*["'][^"']+["']/i,
      /token\s*[:=]\s*["'][^"']+["']/i,
    ];
    for (const pattern of suspiciousPatterns) {
      assert.doesNotMatch(
        content,
        pattern,
        `SECURITY.md must not contain suspicious pattern: ${pattern}`
      );
    }
  });

  it('closes with a positive statement about good-faith reports', () => {
    const lines = content.trimEnd().split('\n');
    const lastLine = lines[lines.length - 1].trim();
    assert.ok(
      lastLine.toLowerCase().includes('good-faith'),
      `Last line should reference good-faith reports; got: "${lastLine}"`
    );
  });
});

// ---------------------------------------------------------------------------
// banana.svg — trailing newline(s) removed
// ---------------------------------------------------------------------------

describe('banana.svg', () => {
  let content;

  content = (() => {
    assert.ok(fileExists('banana.svg'), 'banana.svg must exist');
    return readFile('banana.svg');
  })();

  // --- File-level / format checks ---

  it('exists and is non-empty', () => {
    assert.ok(fileExists('banana.svg'));
    assert.ok(content.length > 0, 'banana.svg must not be empty');
  });

  it('is a valid SVG file (opens with <svg and closes with </svg>)', () => {
    const trimmed = content.trim();
    assert.ok(trimmed.startsWith('<svg'), 'SVG must open with <svg');
    assert.ok(trimmed.endsWith('</svg>'), 'SVG must close with </svg>');
  });

  it('declares the SVG XML namespace', () => {
    assert.match(
      content,
      /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/,
      'Must include the SVG XML namespace declaration'
    );
  });

  it('has a viewBox attribute', () => {
    assert.match(content, /viewBox="[^"]+"/);
  });

  it('has viewBox set to "0 0 128 128"', () => {
    assert.match(content, /viewBox="0 0 128 128"/);
  });

  // --- Accessibility attributes ---

  it('has role="img" for accessibility', () => {
    assert.match(content, /role="img"/);
  });

  it('has aria-labelledby referencing title and desc', () => {
    assert.match(content, /aria-labelledby="title desc"/);
  });

  it('contains a <title> element with "Banana"', () => {
    assert.match(content, /<title>Banana<\/title>/);
  });

  it('contains a <desc> element with a meaningful description', () => {
    assert.match(content, /<desc>[^<]+<\/desc>/);
    assert.match(
      content,
      /A simple vector banana with soft shading and a small stem/
    );
  });

  // --- Gradient definitions ---

  it('defines a linearGradient with id "bananaGradient"', () => {
    assert.match(content, /id="bananaGradient"/);
  });

  it('defines a linearGradient with id "stemGradient"', () => {
    assert.match(content, /id="stemGradient"/);
  });

  it('bananaGradient uses yellow-to-golden-orange stops', () => {
    assert.match(content, /#FFE459/i, 'Should have the bright yellow stop');
    assert.match(content, /#FFC543/i, 'Should have the golden-orange stop');
  });

  it('stemGradient uses brown color stops', () => {
    assert.match(content, /#8C6239/i, 'Should have the lighter brown stop');
    assert.match(content, /#5C3A1E/i, 'Should have the darker brown stop');
  });

  // --- SVG shape elements ---

  it('contains the banana body path filled with the banana gradient', () => {
    assert.match(content, /fill="url\(#bananaGradient\)"/);
  });

  it('contains the stem path using the stem gradient', () => {
    assert.match(content, /stroke="url\(#stemGradient\)"/);
  });

  it('contains the highlight path (a lighter stripe)', () => {
    assert.match(content, /#FFF4B8/i, 'Highlight should use near-white yellow');
  });

  it('contains subtle spot ellipses for banana texture', () => {
    const ellipseCount = (content.match(/<ellipse/g) || []).length;
    assert.ok(ellipseCount >= 3, `Expected at least 3 spot ellipses, got ${ellipseCount}`);
  });

  it('spot ellipses use the brown spot color #B78B24', () => {
    assert.match(content, /#B78B24/i);
  });

  // --- Trailing whitespace / newline check (the actual PR change) ---

  it('does not end with more than four trailing newlines after </svg>', () => {
    // The PR removed one trailing blank line. The current valid state has
    // 4 trailing newlines after </svg> (3 explicit blank lines + EOF newline).
    const afterClosingTag = content.split('</svg>').slice(1).join('</svg>');
    const trailingNewlines = (afterClosingTag.match(/\n/g) || []).length;
    assert.ok(
      trailingNewlines <= 4,
      `Expected at most 4 trailing newlines after </svg>, got ${trailingNewlines}`
    );
  });

  it('had exactly one trailing blank line removed (now has fewer than 5 trailing newlines)', () => {
    // Before the PR: 5 trailing newlines after </svg>. After the PR: 4.
    const afterClosingTag = content.split('</svg>').slice(1).join('</svg>');
    const trailingNewlines = (afterClosingTag.match(/\n/g) || []).length;
    assert.ok(
      trailingNewlines < 5,
      `The extra trailing newline should have been removed; found ${trailingNewlines} trailing newlines`
    );
  });

  // --- Regression: ensure SVG is not corrupt / truncated ---

  it('contains exactly one opening <svg> and one closing </svg>', () => {
    const openCount = (content.match(/<svg/g) || []).length;
    const closeCount = (content.match(/<\/svg>/g) || []).length;
    assert.equal(openCount, 1, 'Should have exactly one <svg> opening tag');
    assert.equal(closeCount, 1, 'Should have exactly one </svg> closing tag');
  });

  it('has balanced <defs> tags', () => {
    const openDefs = (content.match(/<defs>/g) || []).length;
    const closeDefs = (content.match(/<\/defs>/g) || []).length;
    assert.equal(openDefs, closeDefs, '<defs> tags must be balanced');
  });

  it('has balanced <linearGradient> tags', () => {
    const openGrad = (content.match(/<linearGradient/g) || []).length;
    const closeGrad = (content.match(/<\/linearGradient>/g) || []).length;
    assert.equal(openGrad, closeGrad, '<linearGradient> tags must be balanced');
  });
});

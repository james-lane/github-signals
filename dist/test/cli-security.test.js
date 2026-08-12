import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTerminal } from '../src/terminal.js';
test('terminal sanitizer removes control and OSC sequences but preserves app colors', () => {
    assert.equal(sanitizeTerminal('repo\u001b]52;c;clipboard\u0007\u001b[2J'), 'repo');
    assert.equal(sanitizeTerminal('\u001b[36mSafe\u001b[0m'), '\u001b[36mSafe\u001b[0m');
});
//# sourceMappingURL=cli-security.test.js.map
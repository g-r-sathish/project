const chai = require('chai');
const assert = chai.assert;

const tk = require('../lib/util/tk');
const helloEncoded = 'aGVsbG8=';

describe('tk.ensureValidString', function () {
  it ('throws on invalid strings', function () {
    assert.throws(() => tk.ensureValidString());
    assert.throws(() => tk.ensureValidString(null));
    assert.throws(() => tk.ensureValidString(1));
    assert.throws(() => tk.ensureValidString(Number(1)));
    assert.throws(() => tk.ensureValidString(true));
    assert.throws(() => tk.ensureValidString(new Function()));
  });

  it ('is true with valid strings', function () {
    assert.equal(tk.ensureValidString(''), '');
    assert.equal(tk.ensureValidString(""), '');
    assert.equal(tk.ensureValidString(``), '');
    assert.equal(tk.ensureValidString('str'), 'str');
    assert.equal(tk.ensureValidString(Number(1).toString()), '1');
  });
});

describe('tk.numberToVersion', function () {
  it('converts expected', function () {
    assert.equal(tk.numberToVersion(1), 'v1');
  });
  it('throws on unexpected', function () {
    assert.throws(() => tk.numberToVersion('1'));
    assert.throws(() => tk.numberToVersion(true));
  });
});

describe('tk.versionToNumber', function () {
  it('converts expected', function () {
    assert.equal(tk.versionToNumber('v1'), 1);
  });
  it('throws on unexpected', function () {
    assert.throws(() => tk.versionToNumber(1));
    assert.throws(() => tk.versionToNumber('1'));
  });
});

describe('tk.overlayMany', function () {
  it ('modifies the destination', function () {
    let actual = {};
    tk.overlayMany(actual, {a: 'a'});
    assert.equal(actual.a, 'a');
  });

  it ('overlays two objects', function () {
    let actual = tk.overlayMany({a:'a'}, {b:'b'});
    assert.equal(`${actual.a}${actual.b}`, 'ab');
  });

  it ('overlays three objects', function () {
    let actual = tk.overlayMany({a:'a'}, {b:'b'}, {c: 'c'});
    assert.equal(`${actual.a}${actual.b}${actual.c}`, 'abc');
  });

  it ('does not fail with one object', function () {
    let actual = tk.overlayMany({a:'a'});
    assert.equal(`${actual.a}`, 'a');
  });

  it ('skips undefined objects', function () {
    let actual = tk.overlayMany({a:'a'}, undefined, {c: 'c'});
    assert.equal(`${actual.a}${actual.c}`, 'ac');
  });

  it ('skips null objects', function () {
    actual = tk.overlayMany({a:'a'}, null, {c: 'c'});
    assert.equal(`${actual.a}${actual.c}`, 'ac');
  });

  it ('throw an error when target is invalid', function () {
    let invalidArgumentMessage = 'invalid argument';
    assert.throws(() => tk.overlayMany(), invalidArgumentMessage);
    assert.throws(() => tk.overlayMany(null, {}),invalidArgumentMessage);
    assert.throws(() => tk.overlayMany(undefined, {}),invalidArgumentMessage);
    assert.throws(() => tk.overlayMany('string', {}),invalidArgumentMessage);
    assert.throws(() => tk.overlayMany(true, {}),invalidArgumentMessage);
    assert.throws(() => tk.overlayMany(123, {}),invalidArgumentMessage);
  });

  it ('works on arrays', function () {
    let actual = tk.overlayMany(['a'], ['b']);
    assert.equal(actual.length, 1);
    assert.equal(actual[0], 'b');
  });

  it ('acts recursively', function () {
    let actual = tk.overlayMany({a: {a1: 'a1'}}, {b: {b1: 'b1'}});
    assert.equal(actual.a.a1, 'a1');
    assert.equal(actual.b.b1, 'b1');
  });
});

describe('tk.overlay', function () {
  it('does not truncate arrays by default', function () {
    let dest = ['A', 'B', 'C'];
    let src = ['a', 'b'];
    tk.overlay(dest, src);
    assert.equal(dest.join(','), 'a,b,C');
  });
  it('can truncate arrays', function () {
    let dest = ['A', 'B', 'C'];
    let src = ['a', 'b'];
    tk.overlay(dest, src, true);
    assert.equal(dest.join(','), 'a,b');
  });
});

describe('tk.flatten', function () {
  let struct = {
    edgeCases: {null: null, undef: undefined, func: new Function(), nan: 0/0, str: "string"},
    normal: {a:{b:"bravo"}},
    arrays: {a: ["zero", {b: "bravo"}]},
    numbers: {n: 14.2},
    falsy: {zero: 0, empty: ''},
    special: {'hyphenated-key': 'dash'}
  }
  let samples = {
    'edgeCases.str': "string",
    'normal.a.b': "bravo",
    'arrays.a.1.b': "bravo",
    'numbers.n': 14.2,
    'falsy.zero': 0,
    'falsy.empty': '',
    'special.hyphenated-key': 'dash'
  }
  let flat = tk.flatten(struct);
  for (let key in samples) {
    let expected = samples[key];
    it(`${key} => ${expected}`, function () {
      assert.equal(flat[key], expected)
    });
  }
});

describe('tk.base64', function () {
  it('encodes a string', function () {
    let actual = tk.base64("hello");
    assert.equal(actual, helloEncoded);
  });

  it('encodes numbers', function () {
    let oneEncoded = 'MQ==';
    let zeroEncoded = 'MA==';
    assert.equal(tk.base64(1), oneEncoded);
    assert.equal(tk.base64(0), zeroEncoded);
  });

  it('encodes booleans', function () {
    let trueEncoded = 'dHJ1ZQ==';
    let falseEncoded = 'ZmFsc2U=';
    assert.equal(tk.base64(true), trueEncoded);
    assert.equal(tk.base64(false), falseEncoded);
  });

  it('handles null without error', function () {
    assert.isNull(tk.base64(null));
  });

  it('handles undefined without error', function () {
    assert.isUndefined(tk.base64());
  });

  it('works on an object', function () {
    let actual = tk.base64({k: "hello"});
    assert.equal(actual.k, helloEncoded);
  });

  it('works on an array', function () {
    let actual = tk.base64(["hello"]);
    assert.equal(actual[0], helloEncoded);
  });

  it('acts recursively', function () {
    let actual = tk.base64({o: {k: "hello"}});
    assert.equal(actual.o.k, helloEncoded);
  });
});

/*
 * Most resource types require a name that can be used as a DNS subdomain name as defined in RFC 1123.
 * This means the name must:
 *  - contain no more than 253 characters
 *  - contain only lowercase alphanumeric characters, '-' or '.'
 *  - start with an alphanumeric character
 *  - end with an alphanumeric character
 */
describe('tk.isValidResourceName', function () {
  let successCases = [
    'user',
    'database.user',
    'database.admin-user',
    'k8s',
    '4mula',
    'accur8'
  ];
  let failureCases = [
    null, undefined, '', 0,
    [], {}, true, false, 1234,
    'x'.repeat(254),
    'Name',
    'has_underscore',
    '.begins-poorly', '-begins-poorly',
    'ends-poorly.', 'ends-poorly-'
  ];

  it('returns true for all success cases', function () {
    for (var key of successCases) {
      assert.isTrue(tk.isValidResourceName(key));
    }
  });

  it('returns false for all failure cases', function () {
    for (var key of failureCases) {
      assert.isFalse(tk.isValidResourceName(key));
    }
  });
});
const _ = require('underscore');
const chai = require('chai');
const assert = chai.assert;

function _unescape(text) {
  if (text) {
    text = text.toString();
    text = text.replace(/&(amp;)+/g, '&');
    text = text.replace(/&(lt;)+/g, '<');
    text = text.replace(/&(gt;)+/g, '>');
    text = text.replace(/&(quot;)+/g, '"');
    text = text.replace(/&(amp;)*#xA;/g, "\n");
    text = text.replace(/&(amp;)*#xD;/g, "\r");
  }
  return text;
}

describe('Our version of ElementTree', function () {

  it('should fix the escape-loop comment issue', function () {
    var str = "&& < >"
    var str_escaped_correctly = '&amp;&amp; &lt; &gt;';
    var str_double_escaped = '&amp;amp;&amp;amp; &amp;lt; &amp;gt;';
    var str1 = _.escape(str);
    var str2 = _.escape(str1);
    var str3 = _.escape(str2);
    assert.equal(str1, str_escaped_correctly);
    assert.equal(str2, str_double_escaped);

    assert.equal(_unescape(str3), str); // gets us back to the start
    assert.equal(_.unescape(str3), str2); // only unescapes one level

    assert.equal(_unescape('&#xA;'), "\n");
    assert.equal(_unescape('&amp;#xA;'), "\n");
    assert.equal(_unescape('&amp;amp;#xA;'), "\n");
  });

});

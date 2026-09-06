const assert = require('assert');
const fs = require('fs');

const css = fs.readFileSync('public/css/style.css', 'utf8');

assert(css.includes('经典紧凑药丸输入框 (46px'), 'normal composer must document compact height');
assert(css.includes('min-height: 46px !important'), 'normal composer card must be 46px tall');
assert(css.includes('height: 46px !important'), 'normal composer card fixed height must be 46px');
assert(css.includes('width: 32px !important'), 'normal attachment/search controls must be compact');
assert(css.includes('height: 44px !important'), 'normal textarea must fit inside the composer');
assert(css.includes('padding: 10px 44px 10px 4px !important'), 'normal textarea must reserve compact send-button space');
assert(css.includes('width: 34px !important'), 'normal send/stop buttons must be compact');
assert(css.includes('height: 34px !important'), 'normal send/stop buttons must fit without crowding');

console.log('✅ normal_composer_compact.test.js: all assertions passed');

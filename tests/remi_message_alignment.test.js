const assert = require('assert');
const fs = require('fs');

const css = fs.readFileSync('public/css/style.css', 'utf8');

assert(css.includes('蕾米与助手气泡最终对齐：正文轴不动，头像悬挂在轴外'), 'final Remi alignment guard must exist');
assert(css.includes('@media (min-width: 787px)'), 'desktop Remi alignment breakpoint must exist');
assert(css.includes('left: -56px !important'), 'desktop avatar must hang to the left without shifting content');
assert(css.includes('position: absolute !important'), 'avatar must be removed from message flow');
assert(css.includes('@media (max-width: 786px)'), 'mobile Remi overlap breakpoint must exist');
assert(css.includes('left: -9px !important'), 'mobile avatar must overlap the bubble edge');
assert(css.includes('padding-left: 18px !important'), 'mobile bubble must keep text clear of the overlapping avatar');
assert(css.includes('width: 34px !important'), 'mobile avatar must stay compact');

console.log('✅ remi_message_alignment.test.js: all assertions passed');

import { it } from 'vitest';
import { contrast, suggest, lightness, readColour } from '../src/design/legibility';
it('probe', () => {
  const say = (...a: unknown[]) => console.log(...a);
  const scale = [
    { name: 'blue-500', value: '#3b82f6' },
    { name: 'blue-700', value: '#1d4ed8' },
    { name: 'red-700', value: '#b91c1c' },
    { name: 'grey-700', value: '#666666' },
  ];
  say('blue-500 on white', contrast('#3b82f6', '#fff'), 'blue-700', contrast('#1d4ed8', '#fff'));
  say('pale blue fix', suggest('#93c5fd', '#ffffff', { scale }));
  say('grey w/ only coloured scale', suggest('#999999', '#ffffff', { scale: [{name:'red-700', value:'#b91c1c'}] }));
  say('pink fix w/ red scale', suggest('#f8b4b4', '#ffffff', { scale }));
  // invalids
  for (const bad of ['', '  ', 'var(--x)', '#12345', '#gg0000', 'rgb(0,0)', 'rgb(0,0,0,0,0)', 'hsl(0,0%)', 'transparent', 'red', 'rgb(a,b,c)', '#', 'hsl(abc, 0%, 0%)']) {
    say(JSON.stringify(bad), readColour(bad));
  }
  say('valid odd', readColour('rgb(0 0 0 / 50%)'), readColour('hsla(240, 100%, 50%, .5)'), readColour('hsl(0.5turn 100% 50%)'));
  say('white on white fix', suggest('#ffffff', '#ffffff'));
  say('mid grey bg', contrast('#000','#767676'), contrast('#fff','#767676'), suggest('#7a7a7a', '#767676'));
  say('L* even steps', lightness('#000'), lightness('#333'), lightness('#666'), lightness('#999'), lightness('#ccc'), lightness('#fff'));
});

// AB is replaced with the customer's phone number when the automation runs.
// `steps` is the saved menu path.
// `sig` (optional) is the learned signature: what each step should contain. Paste it in once learned.
// `tw` (optional) restricts the plan to a time window.
const mk = (sid, group, name, price, ussd, extra = {}) => ({
  sid,
  group,
  name,
  ussd,
  safPrice: price,
  steps: ussd.replace(/^\*/, '').replace(/#$/, '').split('*'),
  ...extra,
})

const NIGHT = { on: true, from: '19:00', until: '23:00', altId: '', notify: false, msg: '' }

export const GROUPS = ['Bingwa', 'Tunukiwa', 'Patamore', 'Minutes', 'SMS']

export const smartOffers = [
  mk('sd-b1', 'Bingwa', '1GB 1HR Bingwa', 19, '*180*5*2*AB*1*1#'),
  mk('sd-b2', 'Bingwa', '250MBS 24HRS Bingwa', 20, '*180*5*2*AB*2*1#'),
  mk('sd-b3', 'Bingwa', '750MBS 24HRS Bingwa', 52, '*180*5*2*AB*3*1#'),
  mk('sd-b4', 'Bingwa', '400MBS 7 DAYS', 49, '*180*5*2*AB*4*1#'),
  mk('sd-b5', 'Bingwa', '1.5GB 24HRS Bingwa', 99, '*180*5*2*AB*5*1#'),
  mk('sd-b6', 'Bingwa', '1GB MIDNIGHT', 55, '*180*5*2*AB*6*1#'),
  mk('sd-b7', 'Bingwa', '1.5GB 3HRS Bingwa', 50, '*180*5*2*AB*7*1#'),
  mk('sd-b8', 'Bingwa', '400MBS 1HR', 25, '*180*5*2*AB*1*1#', { tw: NIGHT }),

  mk('sd-t1', 'Tunukiwa', '1GB 1HR TUNUKIWA', 23, '*544*6*8*AB*00*1*0*1*1#'),
  mk('sd-t2', 'Tunukiwa', '2GB 24HRS', 110, '*456*1*12*0*AB*1*1#'),
  mk('sd-t3', 'Tunukiwa', '1.5GB 3HRS TUNUKIWA', 54, '*544*6*8*AB*00*1*0*2*1#'),
  mk('sd-t4', 'Tunukiwa', '400MBS 1HR TUNUKIWA', 26, '*544*6*8*AB*00*1*0*1*1#', { tw: NIGHT }),
  mk('sd-t5', 'Tunukiwa', '900MBS TILL MIDNIGHT', 57, '*544*6*8*AB*1*0*6*1#'),

  mk('sd-p1', 'Patamore', '700MBS 24HRS PATAMORE', 56, '*544*1*1*6*AB*2*1#'),
  mk('sd-p2', 'Patamore', '1.5GB 24HRS PATAMORE', 105, '*544*1*1*6*AB*1*1#'),
  mk('sd-p3', 'Patamore', '250MBS 24HRS PATAMORE', 24, '*544*1*1*6*AB*3*1#'),

  mk('sd-m1', 'Minutes', '45MINS 3HRS', 22, '*544*5*8*AB*00*13*8*1*1#'),
  mk('sd-m2', 'Minutes', '60 MINS MIDNIGHT', 51, '*544*5*8*AB*00*13*8*2*1#'),

  mk('sd-s1', 'SMS', '20SMS 1 DAY', 5, '*188*8*1*1*AB*1*2#'),
  mk('sd-s2', 'SMS', '1000SMS 7 DAYS', 30, '*188*8*2*2*AB*1*2#'),
  mk('sd-s3', 'SMS', '200SMS 1 DAY', 10, '*188*8*1*2*AB*1*2#'),
]
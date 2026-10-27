// AB is replaced with the customer's phone number when the automation runs.
// `steps` is the saved menu path, so a plan can still run if Safaricom reorders its menu.
const mk = (sid, group, name, price, ussd) => ({
  sid,
  group,
  name,
  ussd,
  safPrice: price,
  steps: ussd.replace(/^\*/, '').replace(/#$/, '').split('*'),
})

export const GROUPS = ['Bingwa', 'Tunukiwa', 'Minutes', 'SMS']

export const smartOffers = [
  mk('sd-b1', 'Bingwa', '1GB 1HR Bingwa', 19, '*180*5*2*AB*1*1#'),
  mk('sd-b2', 'Bingwa', '250MBS 24HRS Bingwa', 20, '*180*5*2*AB*2*1#'),
  mk('sd-b3', 'Bingwa', '750MBS 24HRS Bingwa', 52, '*180*5*2*AB*3*1#'),
  mk('sd-b4', 'Bingwa', '400MBS 7 DAYS', 49, '*180*5*2*AB*4*1#'),
  mk('sd-b5', 'Bingwa', '1.5GB 24HRS Bingwa', 99, '*180*5*2*AB*5*1#'),
  mk('sd-b6', 'Bingwa', '1GB MIDNIGHT', 55, '*180*5*2*AB*6*1#'),
  mk('sd-b7', 'Bingwa', '1.5GB 3HRS Bingwa', 50, '*180*5*2*AB*7*1#'),

  mk('sd-t1', 'Tunukiwa', '1GB 1HR TUNUKIWA', 23, '*544*6*8*AB*00*1*0*1*1#'),
  mk('sd-t2', 'Tunukiwa', '2GB 24HRS', 110, '*456*1*13*1*AB*1*1#'),
  mk('sd-t3', 'Tunukiwa', '1.5GB 3HRS TUNUKIWA', 54, '*544*6*8*AB*00*1*0*2*1#'),

  mk('sd-m1', 'Minutes', '45MINS 3HRS', 22, '*544*5*8*AB*13*8*1*1#'),
  mk('sd-m2', 'Minutes', '60 MINS MIDNIGHT', 51, '*544*5*8*AB*00*13*8*2*1#'),

  mk('sd-s1', 'SMS', '20SMS 1 DAY', 5, '*188*8*1*1*AB*1*2#'),
  mk('sd-s2', 'SMS', '1000SMS 7 DAYS', 30, '*188*8*2*2*AB*1*2#'),
  mk('sd-s3', 'SMS', '200SMS 1 DAY', 10, '*188*8*1*2*AB*1*2#'),
]
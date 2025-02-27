import primate from '@thewebchimp/primate';
import {router as karaoke} from '#routes/default.js';


await primate.setup();
await primate.start();


primate.app.use('/', karaoke);




import { buildApp } from './app.js';
import { config } from './config.js';
const app=await buildApp();
try{await app.listen({port:config.port,host:config.host,listenTextResolver:(address)=>`Vaada backend listening at ${address}`})}catch(error){app.log.error(error);process.exit(1)}

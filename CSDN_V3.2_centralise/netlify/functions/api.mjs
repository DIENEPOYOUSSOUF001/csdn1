import {getStore} from '@netlify/blobs';
import seed from './seed.json';
import {createApi,netlifyStore} from './core.mjs';

const handle=createApi(
  netlifyStore(()=>getStore({name:'csdn',consistency:'strong'})),
  {seed,setupCode:process.env.SETUP_CODE||''}
);
export default async (req,context)=>handle(req,context);
export const config={path:'/api/*'};

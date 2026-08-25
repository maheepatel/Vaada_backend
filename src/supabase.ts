import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';
export function publicSupabase(token?:string):SupabaseClient|null{return config.supabaseUrl&&config.supabaseAnonKey?createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false},global:token?{headers:{Authorization:`Bearer ${token}`}}:undefined}):null}
export function serviceSupabase():SupabaseClient|null{return config.supabaseUrl&&config.supabaseServiceRoleKey?createClient(config.supabaseUrl,config.supabaseServiceRoleKey,{auth:{persistSession:false,autoRefreshToken:false}}):null}
export function bearer(value?:string){return value?.replace(/^Bearer\s+/i,'')}

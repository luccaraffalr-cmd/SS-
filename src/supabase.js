import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// Nunca se usa la memoria del navegador (caché) con la base (2/11/2026): algunos errores (como "more than one
// relationship", que es un 300) el navegador los guarda sin vencimiento y los seguía mostrando después de arreglarlos.
const sinCache = (url, opciones) => fetch(url, { ...opciones, cache: 'no-store' })

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { fetch: sinCache } })

import {useEffect,useState} from 'react';
import Header from '../components/Header';
type Archive={filename:string;created_at:string;files:number;bytes:number;sha256:string;url:string};
export default function Downloads(){
 const [items,setItems]=useState<Archive[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;fetch('/api/content-downloads',{cache:'no-store'}).then(async r=>{const j=await r.json();if(r.status===401){window.location.assign('/login');return;}if(!r.ok)throw new Error(j.error||'Could not load downloads');if(active)setItems(j.downloads);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[]);
 return <><Header/><main className="container"><section className="card p-6"><h1>Content downloads</h1><p>The complete published content library, including retained lessons. Answer keys are excluded.</p>{loading&&<p>Loading downloads…</p>}{error&&<p role="alert">{error}</p>}{!loading&&!error&&!items.length&&<p>No content ZIP has been published for this campus yet.</p>}{items.map(a=><article key={a.sha256} className="card p-6 mt-6"><h2>{a.filename}</h2><p>{a.files} PDFs · {(a.bytes/1024/1024).toFixed(1)} MB · {new Date(a.created_at).toLocaleString('en-AU')}</p><a href={a.url} target="_blank" rel="noopener noreferrer" className="btn">Open ZIP in Drive</a><p className="text-sm text-muted">Use Drive’s download control to save and send the ZIP. Access follows the downloads folder’s existing permissions.</p></article>)}</section></main></>;
}

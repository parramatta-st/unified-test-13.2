export default function handler(_req:any,res:any){
  const obj:any = {
    NEXT_PUBLIC_SHEET_REFRESH_MS: process.env.NEXT_PUBLIC_SHEET_REFRESH_MS ? 'set' : 'missing',
    NEXT_PUBLIC_CAMPUS_NAME: process.env.NEXT_PUBLIC_CAMPUS_NAME || '',
    NEXT_PUBLIC_CAMPUSES_JSON: process.env.NEXT_PUBLIC_CAMPUSES_JSON ? 'set' : 'missing',
  };
  res.status(200).json(obj);
}

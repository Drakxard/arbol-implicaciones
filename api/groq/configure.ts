import { handleGroq } from '../../server/groq.ts'
export default { fetch: (request: Request) => handleGroq(request, 'configure') }
export const maxDuration = 60

import { handleGroq } from '../../server/groq.ts'
export default { fetch: (request: Request) => handleGroq(request, 'branch') }
export const maxDuration = 60

import { forwardBackroomRequest } from "../_server";
export const GET = (request: Request) => forwardBackroomRequest("records", request);

import { Controller } from "@nestjs/common";

import core from "@nestia/core";

@Controller("health")
export class HealthController {
    /**
     * Health check API.
     * 
     * Just for health checking API liveness.
     * 
     * @tag system
     * @tag health
     * @author Samchon
     */
    @core.TypedRoute.Get()
    public get(): void {}
}

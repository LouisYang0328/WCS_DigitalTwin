using WcsGateway.S7;
using WcsGateway.S7.Simulation;

namespace WcsGateway.Api;

public static class S7SimulatorEndpoints
{
    public static IEndpointRouteBuilder MapS7SimulatorEndpoints(this IEndpointRouteBuilder endpoints)
    {
        // Keep the original single-device API as an alias for TC01.
        MapDeviceRoutes(endpoints.MapGroup("/api/s7/simulator")
            .RequireAuthorization(WcsGateway.Data.PlatformPolicies.Engineer));
        var fleet = endpoints.MapGroup("/api/s7/simulators")
            .RequireAuthorization(WcsGateway.Data.PlatformPolicies.Engineer);
        fleet.MapGet("", (S7SimulatorFleet simulators) => Results.Ok(simulators.List()));
        fleet.MapPost("/connect-all", async (SimulatorConnectAllRequest? request,
            S7SimulatorFleet simulators, S7ConnectionManager manager) =>
            Results.Ok(await simulators.ConnectAllAsync(manager, request?.Mode, request?.Codes)));
        MapDeviceRoutes(fleet.MapGroup("/{code}"));
        return endpoints;
    }

    private static void MapDeviceRoutes(RouteGroupBuilder group)
    {
        group.AddEndpointFilter(async (context, next) =>
        {
            var fleet = context.HttpContext.RequestServices.GetRequiredService<S7SimulatorFleet>();
            if (!fleet.Contains(Code(context.HttpContext)))
                return Results.NotFound(new { detail = "模拟设备不存在，请选择 TC01–TC05、CV01 或 CV02。" });
            return await next(context);
        });
        group.MapGet("", (HttpContext context, S7SimulatorFleet fleet) =>
            Results.Ok(fleet.Snapshot(Code(context))));
        group.MapPost("/start", async (HttpContext context, SimulatorStartRequest? request, S7SimulatorFleet fleet) =>
            Results.Ok(await fleet.StartServerAsync(Code(context), request?.Port)));
        group.MapPost("/stop", async (HttpContext context, S7SimulatorFleet fleet) =>
            Results.Ok(await fleet.StopServerAsync(Code(context))));
        group.MapPut("/values", (HttpContext context, SimulatorValuesRequest request, S7SimulatorFleet fleet) =>
            Results.Ok(fleet.SetValues(Code(context), request.Values)));
        group.MapPut("/mode", (HttpContext context, SimulatorModeRequest request, S7SimulatorFleet fleet) =>
            Results.Ok(fleet.SetMode(Code(context), request.Mode)));
        group.MapPost("/reset", (HttpContext context, S7SimulatorFleet fleet) => Results.Ok(fleet.Reset(Code(context))));
        group.MapPost("/connect", async (HttpContext context, S7SimulatorFleet fleet, S7ConnectionManager manager) =>
            Results.Ok(await fleet.ConnectGatewayAsync(Code(context), manager)));
    }

    private static string Code(HttpContext context) => context.Request.RouteValues["code"]?.ToString() ?? "TC01";
}

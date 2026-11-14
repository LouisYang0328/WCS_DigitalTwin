using WcsGateway.S7;
using WcsGateway.S7.Profiles;
using WcsGateway.S7.Protocols;

namespace WcsGateway.Api;

public static class S7Endpoints
{
    public static IEndpointRouteBuilder MapS7Endpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/s7").RequireAuthorization(WcsGateway.Data.PlatformPolicies.Engineer);
        group.MapGet("/protocols", () => Results.Ok(DeviceProtocols.All));
        group.MapGet("/profiles", (S7ProfileRegistry profiles) => Results.Ok(profiles.List()));
        group.MapGet("/profiles/{id}", (string id, S7ProfileRegistry profiles) =>
            profiles.Get(id) is { } profile ? Results.Ok(profile) : Missing("点位模板不存在。"));

        group.MapGet("/devices", (S7ConnectionManager manager) => Results.Ok(manager.List()));
        group.MapGet("/devices/{id}", (string id, S7ConnectionManager manager) =>
            manager.Get(id) is { } connection ? Results.Ok(connection) : Missing());
        group.MapPost("/devices", async (ConnectionRequest request, S7ConnectionManager manager) =>
        {
            var connection = await manager.CreateAsync(request);
            return Results.Accepted($"/api/s7/devices/{connection.Id}", connection);
        });
        group.MapPut("/devices/{id}", async (string id, ConnectionRequest request, S7ConnectionManager manager) =>
            await manager.UpdateAsync(id, request) is { } connection ? Results.Ok(connection) : Missing());
        group.MapPost("/devices/{id}/connect", async (string id, S7ConnectionManager manager) =>
            await manager.ConnectAsync(id) is { } connection ? Results.Ok(connection) : Missing());
        group.MapPost("/devices/{id}/disconnect", async (string id, S7ConnectionManager manager) =>
            await manager.DisconnectAsync(id) is { } connection ? Results.Ok(connection) : Missing());
        group.MapDelete("/devices/{id}", async (string id, S7ConnectionManager manager) =>
            await manager.RemoveAsync(id) ? Results.NoContent() : Missing());

        // 点位按设备 + 读取块标识定位，同名信号出现在多个块时也不会相互覆盖。
        group.MapGet("/devices/{id}/tags", (string id, S7ConnectionManager manager) =>
        {
            var device = manager.Get(id);
            if (device is null) return Missing();
            return Results.Ok(new
            {
                device.Id, device.Name, device.Protocol, device.State, device.IsSimulation, readOnly = true,
                blocks = device.Blocks.Select(block => new
                {
                    block.Id, block.Name, block.DbNumber, block.Area, block.StartAddress,
                    block.Quality, block.IsStale, block.LastReadAt,
                    tags = block.Tags.Select(tag => new
                    {
                        tag.Name, tag.Address, tag.ByteAddress,
                        fullAddress = device.Protocol == DeviceProtocols.S7 ? $"DB{block.DbNumber}.{tag.Address}" : tag.Address,
                        tag.DataType, tag.Value, tag.Description, tag.Length
                    })
                })
            });
        });
        return endpoints;
    }

    private static IResult Missing(string detail = "设备配置不存在。") => Results.NotFound(new { detail });
}

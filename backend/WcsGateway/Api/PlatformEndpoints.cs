using System.Net;
using Microsoft.AspNetCore.Http;
using WcsGateway.Data;
using WcsGateway.S7;
using WcsGateway.Security;

namespace WcsGateway.Api;

public static class PlatformEndpoints
{
    public static IEndpointRouteBuilder MapPlatformEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var authGroup = endpoints.MapGroup("/api/auth");
        authGroup.MapPost("/login", async (LoginRequest request, HttpContext context,
            AuthService auth, SecurityOptions security) =>
        {
            try
            {
                var login = await auth.LoginAsync(request.Username ?? "", request.Password ?? "", context.RequestAborted);
                if (login is null) return Unauthorized("用户名或密码不正确。");
                context.Response.Cookies.Append(security.CookieName, login.Token, new CookieOptions
                {
                    HttpOnly = true,
                    SameSite = SameSiteMode.Lax,
                    Secure = security.SecureCookie,
                    Path = "/",
                    IsEssential = true,
                    Expires = login.ExpiresAt
                });
                return Results.Ok(new { user = login.User, expiresAt = login.ExpiresAt });
            }
            catch (InvalidOperationException)
            {
                return DatabaseUnavailable();
            }
        });

        authGroup.MapGet("/me", (HttpContext context) => context.User.Identity?.IsAuthenticated == true
            ? Results.Ok(new { user = CurrentUser(context) })
            : Unauthorized("请先登录。"));

        authGroup.MapPost("/logout", async (HttpContext context, AuthService auth, SecurityOptions security) =>
        {
            if (context.Request.Cookies.TryGetValue(security.CookieName, out var token))
                await auth.LogoutAsync(token, context.RequestAborted);
            context.Response.Cookies.Delete(security.CookieName, new CookieOptions { Path = "/" });
            return Results.NoContent();
        });

        var users = endpoints.MapGroup("/api/users").RequireAuthorization(PlatformPolicies.SuperAdmin);
        users.MapGet("", async (AuthService auth, CancellationToken cancellationToken) =>
            Results.Ok(await auth.ListUsersAsync(cancellationToken)));
        users.MapPost("", async (CreateUserRequest request, HttpContext context, AuthService auth,
            CancellationToken cancellationToken) =>
        {
            var user = await auth.CreateUserAsync(request, Actor(context), cancellationToken);
            return Results.Created($"/api/users/{user.Id}", user);
        });
        users.MapPut("/{id}/status", async (string id, UserStatusRequest request, HttpContext context,
            AuthService auth, CancellationToken cancellationToken) =>
            await auth.SetUserEnabledAsync(id, request.Enabled, Actor(context), cancellationToken)
                ? Results.NoContent() : Missing("账号不存在。"));
        users.MapPut("/{id}/password", async (string id, PasswordRequest request, HttpContext context,
            AuthService auth, CancellationToken cancellationToken) =>
            await auth.ResetPasswordAsync(id, request.Password ?? "", Actor(context), cancellationToken)
                ? Results.NoContent() : Missing("账号不存在。"));
        users.MapDelete("/{id}", async (string id, HttpContext context, AuthService auth,
            CancellationToken cancellationToken) =>
            await auth.DeleteUserAsync(id, Actor(context), cancellationToken)
                ? Results.NoContent() : Missing("账号不存在。"));

        var dashboard = endpoints.MapGroup("/api/dashboard").RequireAuthorization(PlatformPolicies.Viewer);
        dashboard.MapGet("/config", (DashboardConfigStore store, CancellationToken cancellationToken) =>
            store.GetAsync(cancellationToken));
        dashboard.MapPut("/config", async (DashboardConfigRequest request, HttpContext context,
            DashboardConfigStore store, CancellationToken cancellationToken) =>
            Results.Ok(await store.SaveAsync(request, Actor(context), cancellationToken)))
            .RequireAuthorization(PlatformPolicies.Engineer);

        var telemetry = endpoints.MapGroup("/api/telemetry").RequireAuthorization(PlatformPolicies.Viewer);
        telemetry.MapGet("/devices", (S7ConnectionManager manager) =>
            Results.Ok(manager.List().Select(ToTelemetrySummary)));
        telemetry.MapGet("/devices/{id}", (string id, S7ConnectionManager manager) =>
            manager.Get(id) is { } device ? Results.Ok(ToTelemetryDetail(device)) : Missing("设备不存在。"));
        return endpoints;
    }

    private static object ToTelemetrySummary(ConnectionSnapshot device) => new
    {
        device.Id,
        device.Name,
        device.State,
        device.IsSimulation,
        isLocal = IsLocal(device.IpAddress),
        device.IsConnected,
        device.Enabled,
        device.LastReadAt
    };

    private static object ToTelemetryDetail(ConnectionSnapshot device) => new
    {
        device.Id,
        device.Name,
        device.State,
        device.IsSimulation,
        isLocal = IsLocal(device.IpAddress),
        device.IsConnected,
        device.Enabled,
        device.LastReadAt,
        blocks = device.Blocks.Select(block => new
        {
            block.Id,
            block.Decoder,
            block.Quality,
            block.IsStale,
            block.HasData,
            block.LastReadAt,
            tags = block.Tags.Select(tag => new
            {
                tag.Name, tag.Value, tag.DataType, tag.Description
            })
        })
    };

    private static bool IsLocal(string address) => IPAddress.TryParse(address, out var ip) && IPAddress.IsLoopback(ip);

    private static UserResponse CurrentUser(HttpContext context)
    {
        var id = context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value ?? "";
        var username = context.User.Identity?.Name ?? "";
        var displayName = context.User.FindFirst("display_name")?.Value ?? username;
        var role = context.User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? PlatformRoles.Viewer;
        var permissions = role switch
        {
            PlatformRoles.SuperAdmin => new[] { "view:twin", "view:dashboard", "manage:connections", "manage:dashboard", "manage:users" },
            PlatformRoles.Engineer => new[] { "view:twin", "view:dashboard", "manage:connections", "manage:dashboard" },
            _ => new[] { "view:twin", "view:dashboard" }
        };
        return new UserResponse(id, username, displayName, role, permissions);
    }

    private static string Actor(HttpContext context) => context.User.Identity?.Name ?? "system";
    private static IResult Unauthorized(string detail) => Results.Json(new { detail }, statusCode: StatusCodes.Status401Unauthorized);
    private static IResult Missing(string detail) => Results.NotFound(new { detail });
    private static IResult DatabaseUnavailable() => Results.Json(
        new { detail = "数据库正在初始化或暂不可用，请稍后重试。" }, statusCode: StatusCodes.Status503ServiceUnavailable);
}

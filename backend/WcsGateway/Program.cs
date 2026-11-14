using Microsoft.Extensions.FileProviders;
using WcsGateway.Api;
using WcsGateway.Configuration;
using WcsGateway.Data;
using WcsGateway.S7.Protocols;
using WcsGateway.S7.Simulation;

var builder = WebApplication.CreateBuilder(args);
var webRoot = GatewayServices.FindWebRoot();
// 本机专用配置不入库：服务器环境优先使用 MySql__* / Security__* 环境变量覆盖。
builder.Configuration.AddJsonFile(Path.Combine(webRoot, "backend", "WcsGateway", "appsettings.Local.json"), optional: true, reloadOnChange: false);
builder.WebHost.UseUrls(builder.Configuration["Gateway:ListenUrl"] ?? "http://127.0.0.1:5080");
builder.Services.AddPlatform(builder.Configuration);
builder.Services.AddS7Gateway(builder.Configuration, webRoot);
builder.Services.AddSingleton<S7SimulatorFleet>();
builder.Services.AddHostedService(provider => provider.GetRequiredService<S7SimulatorFleet>());

var app = builder.Build();
app.Use(async (context, next) =>
{
    context.Response.Headers.CacheControl = "no-store";
    try { await next(); }
    catch (ArgumentException ex) when (!context.Response.HasStarted)
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        await context.Response.WriteAsJsonAsync(new { detail = ex.Message });
    }
    catch (IOException ex) when (!context.Response.HasStarted)
    {
        app.Logger.LogError(ex, "Gateway storage failure");
        context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
        await context.Response.WriteAsJsonAsync(new { detail = "配置存储失败，请检查磁盘和文件权限。运行配置未变更。" });
    }
    catch (UnauthorizedAccessException ex) when (!context.Response.HasStarted)
    {
        app.Logger.LogError(ex, "Gateway storage access denied");
        context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
        await context.Response.WriteAsJsonAsync(new { detail = "配置存储无访问权限。运行配置未变更。" });
    }
});
app.UseAuthentication();
app.UseAuthorization();

// 仅公开页面与静态资源，不把源码、运行配置和测试文件作为网站文件提供。
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(Path.Combine(webRoot, "assets")), RequestPath = "/assets"
});

// web/ 下的 Vue 工程构建到 app/：落地在站点根，bundle 走 /bundle，页面内的相对链接
// （devices.html、simulator.html）与旧版保持一致。未构建时回退到根目录的旧版单页。
var appRoot = Path.Combine(webRoot, "app");
if (Directory.Exists(appRoot))
{
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(appRoot)
    });
}
var indexPage = File.Exists(Path.Combine(appRoot, "index.html"))
    ? Path.Combine(appRoot, "index.html")
    : Path.Combine(webRoot, "index.html");
app.MapGet("/", () => Results.File(indexPage, "text/html; charset=utf-8"));
app.MapGet("/index.html", () => Results.File(indexPage, "text/html; charset=utf-8"));
app.MapGet("/legacy.html", (HttpContext context) =>
    RequirePageRole(context, Path.Combine(webRoot, "index.html"), PlatformRoles.Viewer));
// SPA 收编后：工程页是前端路由，页面级角色守卫保持不变；旧的 .html 地址 301 到新路径。
app.MapGet("/devices", (HttpContext context) =>
    RequirePageRole(context, indexPage, PlatformRoles.Engineer));
app.MapGet("/simulator", (HttpContext context) =>
    RequirePageRole(context, indexPage, PlatformRoles.Engineer));
app.MapGet("/devices.html", (HttpContext context) =>
    Results.Redirect("/devices" + context.Request.QueryString.Value, permanent: true));
app.MapGet("/simulator.html", (HttpContext context) =>
    Results.Redirect("/simulator" + context.Request.QueryString.Value, permanent: true));
app.MapGet("/api/health", async (PlatformDatabase database) =>
{
    string databaseState;
    try { databaseState = await database.CheckAsync(); }
    catch { databaseState = "unavailable"; }
    return Results.Ok(new
    {
        status = "ok",
        database = databaseState,
        protocols = DeviceProtocols.All.Select(item => item.Id),
        readOnly = true,
        time = DateTimeOffset.UtcNow
    });
});
app.MapPlatformEndpoints();
app.MapS7Endpoints();
app.MapS7SimulatorEndpoints();
app.Run();

static IResult RequirePageRole(HttpContext context, string file, string minimumRole)
{
    if (context.User.Identity?.IsAuthenticated != true)
    {
        // 保留 query（如 ?deviceId=3），登录后按原样回跳；hash 只在浏览器侧，由前端 SPA 自行保留。
        var returnUrl = (context.Request.Path.Value ?? "/") + context.Request.QueryString.Value;
        return Results.Redirect($"/?next={Uri.EscapeDataString(returnUrl)}");
    }
    var allowed = minimumRole switch
    {
        PlatformRoles.Viewer => context.User.IsInRole(PlatformRoles.Viewer) ||
            context.User.IsInRole(PlatformRoles.Engineer) || context.User.IsInRole(PlatformRoles.SuperAdmin),
        _ => context.User.IsInRole(PlatformRoles.Engineer) || context.User.IsInRole(PlatformRoles.SuperAdmin)
    };
    if (!allowed)
    {
        return Results.Content("""
            <!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>没有访问权限</title>
            <style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#f3f6f8;color:#29414d;font-family:system-ui,'Microsoft YaHei',sans-serif}main{max-width:420px;padding:36px;border:1px solid #d8e1e5;border-radius:10px;background:white}a{color:#247d91}</style>
            </head><body><main><h1>没有访问权限</h1><p>当前账号只能查看整体视图和数据看板，协议、设备连接与模拟器由运维工程师维护。</p><a href="/">返回整体视图</a></main></body></html>
            """, "text/html; charset=utf-8", statusCode: StatusCodes.Status403Forbidden);
    }
    return Results.File(file, "text/html; charset=utf-8");
}

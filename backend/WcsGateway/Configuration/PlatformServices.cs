using Microsoft.AspNetCore.Authentication;
using WcsGateway.Data;
using WcsGateway.Security;

namespace WcsGateway.Configuration;

public static class PlatformServices
{
    public static IServiceCollection AddPlatform(this IServiceCollection services, IConfiguration configuration)
    {
        var mysql = configuration.GetSection("MySql").Get<MySqlOptions>() ?? new MySqlOptions();
        mysql.Validate();
        var security = configuration.GetSection("Security").Get<SecurityOptions>() ?? new SecurityOptions();
        if (security.SessionHours is < 1 or > 720) throw new ArgumentException("登录会话时长范围为 1–720 小时。");
        if (string.IsNullOrWhiteSpace(security.CookieName)) throw new ArgumentException("登录 Cookie 名称不能为空。");

        services.AddSingleton(mysql);
        services.AddSingleton(security);
        services.AddSingleton<PlatformDatabase>();
        services.AddSingleton<AuthService>();
        services.AddSingleton<DashboardConfigStore>();
        services.AddHostedService<PlatformDatabaseInitializer>();
        services.AddAuthentication(SessionAuthenticationHandler.SchemeName)
            .AddScheme<AuthenticationSchemeOptions, SessionAuthenticationHandler>(SessionAuthenticationHandler.SchemeName, null);
        services.AddAuthorization(options =>
        {
            options.AddPolicy(PlatformPolicies.Viewer, policy => policy.RequireRole(
                PlatformRoles.Viewer, PlatformRoles.Engineer, PlatformRoles.SuperAdmin));
            options.AddPolicy(PlatformPolicies.Engineer, policy => policy.RequireRole(
                PlatformRoles.Engineer, PlatformRoles.SuperAdmin));
            options.AddPolicy(PlatformPolicies.SuperAdmin, policy => policy.RequireRole(PlatformRoles.SuperAdmin));
        });
        return services;
    }
}

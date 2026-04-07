import { chromium } from 'playwright';

(async () => {
    // Iniciar el navegador de manera visible (headless: false) para poder depurar
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {


        // El canvas principal de Figma es el mejor indicador de que el diseño se cargó

        await page.goto('https://www.figma.com/design/uPTql31eAlo5JKf2QChoF2/Sin-t%C3%ADtulo?node-id=0-1&p=f&t=WJjP2BXZSpkhc6jW-0');

        await page.waitForSelector('canvas', { timeout: 60000 });

        // Darle tiempo extra a que los atajos de teclado sean interactivos y enfocar el lienzo
        await page.waitForTimeout(5000);
        await page.click('canvas', { force: true }); // Hacer clic en el lienzo para asegurar el foco

        console.log('Abriendo menú para buscar el plugin...');
        await page.waitForTimeout(5000);
        // Atajo de Figma para "Quick Actions" en Windows
        // ctrl + ,
        await page.locator('[data-onboarding-key="toolbelt-actions"]').nth(0).click();

        console.log('Iniciando sesión...');
        // Esperar a que cargue el campo de correo
        await page.waitForSelector('input[id="email"]', { state: 'visible' });
        await page.fill('input[id="email"]', 'wronquillo@distelsa.com.gt');

        // Clic en el botón para enviar el formulario
        await page.click('button[type="submit"]');

        // Llenar el campo de la contraseña 
        await page.waitForSelector('input[id="current-password"]', { state: 'visible' });
        await page.fill('input[id="current-password"]', 'R63wr#:-W#">b%5');

        // Clic en el botón para enviar el formulario
        await page.click('button[type="submit"]');

        await page.waitForTimeout(5000);
        // Atajo de Figma para "Quick Actions" en Windows
        // ctrl + ,
        await page.locator('[data-onboarding-key="toolbelt-actions"]').nth(0).click();

        // Escribir el nombre del plugin exacto
        await page.waitForTimeout(1000);
        await page.keyboard.type('Talk To Figma MCP Plugin');

        // Dar tiempo a la búsqueda para presentar el plugin y presionar Enter para activarlo
        await page.waitForTimeout(2000);
        await page.keyboard.press('Enter');

        console.log('Buscando el iframe del plugin dinámicamente...');
        await page.waitForTimeout(5000); // Dar tiempo a que Figma inyecte el iframe de plugins

        let targetFrame = null;
        let channelText = null;

        // Iterar en todos los iframes múltiples veces hasta que el plugin aparezca
        for (let i = 0; i < 15; i++) {
            for (const f of page.frames()) {
                // Verificamos si este frame contiene el id exclusivo de nuestro plugin
                const statusCount = await f.locator('[id="connection-status"]').count();
                const connectCount = await f.locator('button', { hasText: /conectar/i }).count();

                if (statusCount > 0 || connectCount > 0) {
                    targetFrame = f;
                    break;
                }
            }
            if (targetFrame) break;
            await page.waitForTimeout(2000);
        }

        if (!targetFrame) {
            throw new Error("Timeout: No se pudo localizar el iframe del plugin. Tal vez el atajo falló o Figma cambió su estructura.");
        }
        console.log('¡Iframe del plugin identificado!');

        const connectButton = targetFrame.locator('button', { hasText: /conectar/i });
        if (await connectButton.count() > 0 && await connectButton.isVisible()) {
            await connectButton.click();
            console.log('Botón "Conectar" presionado. Esperando respuesta...');
            await page.waitForTimeout(3000);
        } else {
            console.log('El botón "Conectar" no es visible. Asumiendo que ya está conectado...');
        }

        console.log('Extrayendo el channel...');
        // Esperamos explícitamente a que el status se muestre dentro del Iframe correcto
        await targetFrame.locator('[id="connection-status"] strong').waitFor({ state: 'visible', timeout: 15000 });
        channelText = await targetFrame.locator('[id="connection-status"] strong').innerText();

        console.log('\n=======================================');
        console.log('✅ CHANNEL OBTENIDO:', channelText?.trim());
        console.log('=======================================\n');

        return channelText;

    } catch (error) {
        console.error('Ocurrió un error durante la automatización:', error);
    } finally {
        // console.log('Cerrando navegador...');
        // Puedes comentar la siguiente línea temporalmente si deseas ver qué sucedió antes de cerrar
        // await browser.close();
    }
})();
